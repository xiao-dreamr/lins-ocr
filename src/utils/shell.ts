/**
 * Shell 工具函数
 * 用于安全地把用户可配置的值拼进 bash -c 命令字符串。
 */

/**
 * 用单引号包裹字符串并对内部单引号做转义（' → '\''），
 * 防止用户设置中的引号、分号等造成命令注入。
 */
export function shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
