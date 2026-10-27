import { COMPANY_NAME_LINES, PRODUCT_NAME } from "../product-config";
import { ProductLogo } from "./ProductLogo";
import "./ProductBrand.css";

export function ProductBrand() {
  return (
    <span className="product-brand">
      <span className="product-brand-mark"><ProductLogo /></span>
      <span className="product-brand-name">
        <strong>{COMPANY_NAME_LINES.map(line => <span key={line}>{line}</span>)}</strong>
        <small>{PRODUCT_NAME}</small>
      </span>
    </span>
  );
}
