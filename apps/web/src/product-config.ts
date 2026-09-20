import { resolveProductName } from "../product.config";

export const PRODUCT_NAME = resolveProductName(import.meta.env.VITE_PRODUCT_NAME);
