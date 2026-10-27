export const COMPANY_NAME_LINES = ["中船黄冈", "贵金属有限公司"] as const;
export const COMPANY_NAME = COMPANY_NAME_LINES.join("");
export const DEFAULT_PRODUCT_NAME = "设备智能运维平台";

export function resolveProductName(configuredName: string | undefined): string {
  if (configuredName === undefined) {
    return DEFAULT_PRODUCT_NAME;
  }

  const productName = configuredName.trim();
  if (productName.length === 0) {
    throw new Error("VITE_PRODUCT_NAME 已配置但为空，请提供非空产品名称。");
  }

  return productName;
}
