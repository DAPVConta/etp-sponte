/**
 * Converte HEX (#RRGGBB) para componentes HSL como string "H S% L%"
 * compatível com as variáveis CSS do Tailwind/shadcn.
 */
export function hexToHsl(hex: string): string {
  const c = hex.replace('#', '');
  let r = parseInt(c.substring(0, 2), 16) / 255;
  let g = parseInt(c.substring(2, 4), 16) / 255;
  let b = parseInt(c.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Retorna true se a cor hex for "clara" (luminância > 150).
 * Útil para decidir se o texto sobre ela deve ser escuro.
 */
export function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

/**
 * Retorna a cor de foreground ideal (preto ou branco)
 * como HSL para uso em variáveis CSS.
 */
export function contrastForeground(hex: string): string {
  return isLightColor(hex) ? '222 47% 11%' : '0 0% 100%';
}
