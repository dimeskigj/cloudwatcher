interface BrandProps {
  class?: string;
}

export function Brand({ class: className }: BrandProps) {
  return <span aria-hidden="true" class={`brand ${className ?? ""}`} />;
}
