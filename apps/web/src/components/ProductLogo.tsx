import { COMPANY_NAME } from "../product-config";
import "./ProductLogo.css";

export function ProductLogo({ className = "" }: { className?: string }) {
  return (
    <img
      alt={`${COMPANY_NAME} Logo`}
      className={`product-logo ${className}`}
      draggable={false}
      height={38}
      src={`${import.meta.env.BASE_URL}branding/cssc-logo.svg`}
      width={138}
    />
  );
}
