import { Settings, BarChart3, GripVertical } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DASHBOARD_SECTIONS,
  useDashboardVisibility,
  type DashboardSectionId,
} from '@/hooks/use-dashboard-visibility';

interface Props {
  accentColor: string;
}

function SortableItem({
  section,
  idx,
  checked,
  accentColor,
  onToggle,
}: {
  section: { id: DashboardSectionId; label: string };
  idx: number;
  checked: boolean;
  accentColor: string;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : 'auto',
      }}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors bg-card',
        'hover:bg-muted/50',
        idx > 0 && 'border-t border-border/40'
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex items-center text-muted-foreground/40 flex-shrink-0 cursor-grab active:cursor-grabbing hover:text-muted-foreground transition-colors"
        title="Arrastar para reordenar"
      >
        <GripVertical size={14} />
      </button>

      {/* Checkbox */}
      <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="sr-only peer"
        />
        <div
          className={cn(
            'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all',
            checked
              ? 'border-transparent'
              : 'border-border bg-background'
          )}
          style={checked ? { background: accentColor } : {}}
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* Ícone + label */}
        <BarChart3 size={16} className={cn('flex-shrink-0', checked ? 'text-foreground' : 'text-muted-foreground/50')} />
        <span className={cn('text-sm truncate', checked ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {section.label}
        </span>
      </label>

      {/* Badge de ordem */}
      <span className={cn(
        'ml-auto text-[0.65rem] font-semibold tabular-nums px-1.5 py-0.5 rounded flex-shrink-0',
        checked
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground/50'
      )}>
        #{idx + 1}
      </span>
    </div>
  );
}

export default function ConfiguracoesGraficosPage({ accentColor }: Props) {
  const { isVisible, toggle, order, reorder } = useDashboardVisibility();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = order.indexOf(active.id as DashboardSectionId);
      const newIdx = order.indexOf(over.id as DashboardSectionId);
      reorder(arrayMove(order, oldIdx, newIdx));
    }
  };

  // Build ordered sections list from saved order
  const orderedSections = order.map(id => DASHBOARD_SECTIONS.find(s => s.id === id)!).filter(Boolean);

  return (
    <div className="p-8">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-8">
        <Settings size={24} style={{ color: accentColor }} />
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
      </div>

      {/* Seção Gráficos */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">Gráficos</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Selecione quais componentes devem aparecer no Dashboard. Arraste para reordenar.
          </p>
        </div>

        <Card className="max-w-xl border border-border bg-card p-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {orderedSections.map((section, idx) => (
                <SortableItem
                  key={section.id}
                  section={section}
                  idx={idx}
                  checked={isVisible(section.id)}
                  accentColor={accentColor}
                  onToggle={() => toggle(section.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </Card>

        <p className="text-xs text-muted-foreground mt-3">
          As alterações são aplicadas imediatamente no Dashboard.
        </p>
      </section>
    </div>
  );
}
