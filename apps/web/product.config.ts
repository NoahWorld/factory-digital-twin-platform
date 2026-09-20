export const DEFAULT_PRODUCT_NAME = "Kingdom 3D vision";

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
