import "./ProductLogo.css";

export function ProductLogo({ className = "" }: { className?: string }) {
  return (
    <img
      alt="Kingdom 凯德"
      className={`product-logo ${className}`}
      draggable={false}
      height={239}
      src={`${import.meta.env.BASE_URL}branding/kingdom-logo.png`}
      width={371}
    />
  );
}
