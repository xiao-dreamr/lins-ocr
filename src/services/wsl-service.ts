import { exec } from 'child_process';
import { requestUrl } from 'obsidian';
import type { LinsOCRSettings } from '../settings';

/**
 * WSL 服务生命周期管理器
 * 负责 PaddleOCR-VL HTTP 服务的健康检查、启动、停止和空闲关闭。
 */
export class WslServiceManager {
    private servicePid: string | null = null;
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
     */
    async startService(): Promise<boolean> {
        try {
            const condaRoot = this.getCondaRoot(this.settings.condaEnvPath);
            const envName = this.settings.condaEnvPath.split('/').pop() ?? 'paddle';

            // 构建启动命令：conda 激活环境 + 设置环境变量 + 后台运行
            const innerCmd = [
                `source "${condaRoot}/etc/profile.d/conda.sh"`,
                `conda activate "${envName}"`,
                `FLAGS_allocator_strategy=naive_best_fit nohup paddlex --serve --port ${this.settings.servicePort} > /dev/null 2>&1 &`,
                // WSL 中 echo $! 拿到的 pid 是 wsl 内的进程 pid
            ].join(' && ');

            const wslCmd = `wsl -d ${this.settings.wslDistro} -- bash -c '${innerCmd}'`;

            console.log('[LinsOCR] Starting WSL service:', wslCmd);

            // 立即执行启动命令，不等待进程退出
            exec(wslCmd, (error, stdout) => {
                if (error) {
                    console.error('[LinsOCR] Failed to start service:', error.message);
                    return;
                }
                const pid = stdout.trim();
                if (pid) {
                    this.servicePid = pid;
                    console.log('[LinsOCR] Service started with PID:', pid);
                }
            });

            // 等待一小段时间让进程启动
            await this.sleep(2000);
            return true;
        } catch (error) {
            console.error('[LinsOCR] Error starting service:', error);
            return false;
        }
    }

    /**
     * 停止 WSL 中的服务
     */
    async stopService(): Promise<void> {
        try {
            // 优先通过端口杀进程
            const killCmd = `wsl -d ${this.settings.wslDistro} -- bash -c 'fuser -k ${this.settings.servicePort}/tcp 2>/dev/null || true'`;
            console.log('[LinsOCR] Stopping service via port:', killCmd);
            await this.execWsl(killCmd);
            this.servicePid = null;
        } catch (error) {
            console.error('[LinsOCR] Error stopping service:', error);
        }
    }

    /**
     * 确保服务正在运行：先健康检查，失败则启动并轮询等待就绪
     */
    async ensureServiceRunning(): Promise<boolean> {
        // 先尝试健康检查
        const healthy = await this.checkHealth();
        if (healthy) {
            console.log('[LinsOCR] Service is already running');
            return true;
        }

        console.log('[LinsOCR] Service not responding, starting...');
        await this.startService();

        // 轮询等待服务就绪（最多 30 秒）
        const maxAttempts = 15;
        const intervalMs = 2000;

        for (let i = 0; i < maxAttempts; i++) {
            await this.sleep(intervalMs);
            const alive = await this.checkHealth();
            if (alive) {
                console.log('[LinsOCR] Service ready after', (i + 1) * 2, 'seconds');
                return true;
            }
        }

        console.error('[LinsOCR] Service failed to become ready within timeout');
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
     * 例如 /home/lin/miniconda3/envs/paddle → /home/lin/miniconda3
     */
    private getCondaRoot(envPath: string): string {
        const parts = envPath.split('/');
        // 去掉最后两级：envs/<name>
        if (parts.length >= 2 && parts[parts.length - 2] === 'envs') {
            return parts.slice(0, -2).join('/');
        }
        // 回退：如果无法推导，假设 miniconda3 模式
        return envPath.replace(/\/envs\/[^/]+$/, '');
    }

    private execWsl(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`WSL exec failed: ${error.message}. stderr: ${stderr}`));
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
