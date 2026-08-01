import { spawn, ChildProcess } from 'child_process';
import { requestUrl } from 'obsidian';
import type { LinsOCRSettings } from '../settings';
import { shellQuote } from '../utils/shell';

/**
 * WSL 服务生命周期管理器
 *
 * 关键设计决策：paddlex 在前台运行（不用 & / nohup），
 * 由 spawn 返回的 ChildProcess 保持 WSL 会话存活。
 *
 * 原因：WSL2 在初始 bash 进程退出后会终止整个 VM，
 * 即使用 nohup + disown，后台进程也会被 WSL2 杀掉。
 */
export class WslServiceManager {
    private serviceProcess: ChildProcess | null = null;
    private shutdownTimer: ReturnType<typeof setTimeout> | null = null;
    private settings: LinsOCRSettings;

    constructor(settings: LinsOCRSettings) {
        this.settings = settings;
    }

    updateSettings(settings: LinsOCRSettings): void {
        this.settings = settings;
    }

    /**
     * 健康检查：GET /health，期望 status=200 且 errorCode=0
     */
    async checkHealth(): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: this.settings.healthCheckUrl,
                method: 'GET',
                throw: false,
            });
            if (response.status !== 200) {
                return false;
            }
            const data = response.json;
            return data?.errorCode === 0;
        } catch {
            return false;
        }
    }

    /**
     * 启动 WSL 中的 PaddleOCR-VL 服务
     *
     * paddlex 在前台运行（无 &），spawn 进程保持存活以确保
     * WSL2 VM 不会在启动后立即终止。
     */
    startService(): Promise<boolean> {
        // 如果已有进程在运行，先关闭
        if (this.serviceProcess) {
            this.killServiceProcess();
        }

        return new Promise((resolve) => {
            const condaRoot = this.getCondaRoot(this.settings.condaEnvPath);
            const envName = this.settings.condaEnvPath.split('/').pop() ?? 'paddle';
            const logFile = '/tmp/linsocr-service.log';
            const port = this.settings.servicePort;

            // 前台运行（无 &），bash 会阻塞直到 paddlex 退出
            // wsl.exe 进程存活 = WSL2 VM 存活 = paddlex 存活
            const innerCmd =
                `echo "=== LinsOCR service start $(date) ===" > ${logFile} && ` +
                `source ${shellQuote(condaRoot)}/etc/profile.d/conda.sh && ` +
                `conda activate ${shellQuote(envName)} && ` +
                `env FLAGS_allocator_strategy=naive_best_fit paddlex --pipeline ${shellQuote(this.settings.pipelineName)} --serve --port ${port} >> ${logFile} 2>&1`;

            console.log('[LinsOCR] Starting WSL service (foreground mode)...');
            console.log('[LinsOCR] innerCmd:', innerCmd);

            const child = spawn('wsl', [
                '-d', this.settings.wslDistro,
                '--', 'bash', '-c', innerCmd,
            ], {
                // 不设 detached，让子进程随父进程生命周期
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            // 必须消费 stdout/stderr，否则缓冲区满后子进程会挂起
            child.stdout?.on('data', () => { /* 输出已重定向到日志文件 */ });
            child.stderr?.on('data', (data: Buffer) => {
                console.error('[LinsOCR] service stderr:', data.toString().trim());
            });

            child.on('error', (err) => {
                console.error('[LinsOCR] spawn error:', err.message);
                this.serviceProcess = null;
                resolve(false);
            });

            child.on('close', (code) => {
                console.log('[LinsOCR] service process exited with code:', code);
                this.serviceProcess = null;
            });

            this.serviceProcess = child;

            // 给 conda 初始化 + 模型加载留时间
            this.sleep(2000).then(() => resolve(true));
        });
    }

    /**
     * 停止 WSL 中的服务
     */
    async stopService(): Promise<void> {
        this.killServiceProcess();
        // 兜底：通过端口杀（处理 serviceProcess 为 null 的边界情况）
        try {
            const port = this.settings.servicePort;
            await this.spawnWsl(`fuser -k ${port}/tcp 2>/dev/null || true`);
        } catch {
            // 忽略
        }
    }

    /**
     * 确保服务正在运行：先健康检查，失败则启动并轮询等待就绪
     */
    async ensureServiceRunning(): Promise<boolean> {
        const healthy = await this.checkHealth();
        if (healthy) {
            console.log('[LinsOCR] Service is already running');
            return true;
        }

        console.log('[LinsOCR] Service not responding, starting...');
        await this.startService();

        // 轮询等待服务就绪（最多 120 秒）
        const maxAttempts = 60;
        const intervalMs = 2000;

        for (let i = 0; i < maxAttempts; i++) {
            await this.sleep(intervalMs);
            const alive = await this.checkHealth();
            if (alive) {
                console.log('[LinsOCR] Service ready after', (i + 1) * 2, 'seconds');
                return true;
            }
        }

        console.error('[LinsOCR] Service failed to become ready within 120s');
        console.error('[LinsOCR] Check WSL log: cat /tmp/linsocr-service.log');
        return false;
    }

    /**
     * 调度空闲关闭
     */
    scheduleShutdown(timeoutSeconds?: number): void {
        this.cancelShutdown();
        const delay = (timeoutSeconds ?? this.settings.idleTimeout) * 1000;
        console.log(`[LinsOCR] Scheduling shutdown in ${delay / 1000}s`);
        this.shutdownTimer = setTimeout(() => {
            console.log('[LinsOCR] Idle timeout reached, shutting down...');
            this.stopService().catch(console.error);
        }, delay);
    }

    /**
     * 取消空闲关闭定时器
     */
    cancelShutdown(): void {
        if (this.shutdownTimer !== null) {
            clearTimeout(this.shutdownTimer);
            this.shutdownTimer = null;
        }
    }

    /**
     * 立即关闭（插件卸载时调用）
     */
    async shutdown(): Promise<void> {
        this.cancelShutdown();
        await this.stopService();
    }

    /**
     * 在 WSL 中执行任意命令并返回输出
     */
    async execWsl(command: string): Promise<string> {
        return this.spawnWsl(command);
    }

    // ---- 私有辅助 ----

    /**
     * 杀死服务进程（SIGTERM → 超时后 SIGKILL）
     */
    private killServiceProcess(): void {
        if (!this.serviceProcess) return;

        const child = this.serviceProcess;

        // 先尝试优雅终止
        const killed = child.kill('SIGTERM');
        if (!killed) {
            // 已经退出
            this.serviceProcess = null;
            return;
        }

        // 5 秒后如果还没退出，强制杀
        const forceKill = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
                console.log('[LinsOCR] Force killing service process');
                child.kill('SIGKILL');
            }
        }, 5000);

        child.on('close', () => {
            clearTimeout(forceKill);
            this.serviceProcess = null;
        });
    }

    /**
     * 从 conda 环境路径推导 conda 根目录
     */
    private getCondaRoot(envPath: string): string {
        const parts = envPath.split('/');
        if (parts.length >= 2 && parts[parts.length - 2] === 'envs') {
            return parts.slice(0, -2).join('/');
        }
        return envPath.replace(/\/envs\/[^/]+$/, '');
    }

    /**
     * 通过 spawn 在 WSL 中执行一条简单命令
     */
    private spawnWsl(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn('wsl', [
                '-d', this.settings.wslDistro,
                '--', 'bash', '-c', command,
            ]);

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });
            child.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            child.on('error', (err) => {
                reject(new Error(`spawn failed: ${err.message}`));
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`WSL command exited with code ${code}. stderr: ${stderr}`));
                }
            });
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
