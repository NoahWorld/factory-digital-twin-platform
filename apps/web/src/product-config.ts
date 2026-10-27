import { resolveProductName } from "../product.config";

export { COMPANY_NAME, COMPANY_NAME_LINES } from "../product.config";

export const PRODUCT_NAME = resolveProductName(import.meta.env.VITE_PRODUCT_NAME);
