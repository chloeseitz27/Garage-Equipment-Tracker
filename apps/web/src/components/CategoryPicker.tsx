import type { Category } from '@garage/shared';
import { MultiSelectFilter } from './MultiSelectFilter.js';

interface Props {
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
  emptyLabel?: string;
  hint?: string;
}

export function CategoryPicker({
  categories, selected, onChange, disabled = false, label = 'Categories',
  emptyLabel = 'Choose categories...', hint = 'Select one or more categories.',
}: Props): JSX.Element {
  return (
    <div className="category-picker">
      <span className="picker-label">{label}</span>
      <MultiSelectFilter
        label={label}
        purpose="selection"
        emptyLabel={emptyLabel}
        options={categories.map((category) => ({ value: category.id, label: category.name }))}
        selected={selected}
        disabled={disabled}
        onChange={(ids) => onChange([...ids].sort())}
        hint={hint}
      />
      <span className="hint">{hint}</span>
    </div>
  );
}
