import { Info } from 'lucide-react';

// Icone de ajuda com tooltip nativo — usado nos titulos de cards,
// graficos e tabelas para explicar a metrica/fonte de dados.
export function HelpHint({ text, className }: { text: string; className?: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className={
        'inline-flex items-center text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-help flex-shrink-0 ' +
        (className ?? '')
      }
    >
      <Info size={13} />
    </span>
  );
}
