import { spawn } from 'child_process';
import { requestUrl } from 'obsidian';
import type { LinsOCRSettings } from '../settings';

/**
 * WSL 服务生命周期管理器
 * 负责 PaddleOCR-VL HTTP 服务的健康检查、启动、停止和空闲关闭。
 *
 * 使用 spawn（而非 exec）来避免 Windows cmd.exe 对引号的二次解析，
 * 这是跨 WSL 边界传递命令时最常见的出错原因。
 */
export class WslServiceManager {
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
     * 使用 spawn + 参数数组，完全避开 shell 引号解析。
     */
    startService(): Promise<boolean> {
        return new Promise((resolve) => {
            const condaRoot = this.getCondaRoot(this.settings.condaEnvPath);
            const envName = this.settings.condaEnvPath.split('/').pop() ?? 'paddle';
            const logFile = '/tmp/linsocr-service.log';
            const port = this.settings.servicePort;

            // 时间戳标记 + conda 激活 + 后台启动 paddlex
            // 注意：重定向直接跟在 nohup 命令上（不在 subshell 中），
            // 用 env 设置环境变量，最后 disown 防止 bash 退出时杀后台进程
            const innerCmd =
                `echo "=== LinsOCR service start $(date) ===" > ${logFile} && ` +
                `source ${condaRoot}/etc/profile.d/conda.sh && ` +
                `conda activate ${envName} && ` +
                `nohup env FLAGS_allocator_strategy=naive_best_fit paddlex --serve --port ${port} >> ${logFile} 2>&1 & ` +
                `disown`;

            console.log('[LinsOCR] Starting WSL service...');
            console.log('[LinsOCR] innerCmd:', innerCmd);

            const child = spawn('wsl', [
                '-d', this.settings.wslDistro,
                '--', 'bash', '-c', innerCmd,
            ]);

            let stderr = '';

            child.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            child.on('error', (err) => {
                console.error('[LinsOCR] spawn error:', err.message);
                resolve(false);
            });

            child.on('close', (code) => {
                if (stderr) {
                    console.error('[LinsOCR] bash stderr:', stderr.trim());
                }
                console.log('[LinsOCR] bash exited with code:', code);
            });

            this.sleep(2000).then(() => resolve(true));
        });
    }

    /**
     * 停止 WSL 中的服务（通过端口杀进程）
     */
    async stopService(): Promise<void> {
        try {
            const port = this.settings.servicePort;
            const killCmd = `fuser -k ${port}/tcp 2>/dev/null || true`;

            console.log('[LinsOCR] Stopping service on port', port);
            await this.spawnWsl(killCmd);
        } catch (error) {
            console.error('[LinsOCR] Error stopping service:', error);
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

        // 轮询等待服务就绪（最多 120 秒，首次加载模型较慢）
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

    // ---- 私有辅助 ----

    /**
     * 从 conda 环境路径推导 conda 根目录
     * /home/lin/miniconda3/envs/paddle → /home/lin/miniconda3
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
