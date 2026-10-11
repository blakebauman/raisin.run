/**
 * Corrections to page types. People don't edit types directly: every edit becomes names for URL
 * patterns (`page_type_names`), which grouping applies to this crawl and every later crawl of the
 * project. Patterns given the same name form one type.
 */

export type PageTypeEdit =
  | { kind: 'rename'; typeId: number; name: string }
  | { kind: 'merge'; typeId: number; into: number }
  | { kind: 'split'; typeId: number; pattern: string }
  | { kind: 'reset'; typeId: number };

type EditableType = { id: number; label: string; patterns: string[] };

/** Pattern → name to write, and patterns whose names to delete. */
export type NameChanges = { set: Record<string, string>; clear: string[] };

export const MAX_TYPE_NAME = 80;

export function parsePageTypeEdit(form: FormData): PageTypeEdit | null {
  const typeId = positiveInt(form.get('typeId'));
  if (typeId === null) return null;
  switch (form.get('intent')) {
    case 'type-rename':
      return { kind: 'rename', typeId, name: String(form.get('name') ?? '') };
    case 'type-merge': {
      const into = positiveInt(form.get('into'));
      return into === null ? null : { kind: 'merge', typeId, into };
    }
    case 'type-split': {
      const pattern = form.get('pattern');
      return typeof pattern === 'string' && pattern ? { kind: 'split', typeId, pattern } : null;
    }
    case 'type-reset':
      return { kind: 'reset', typeId };
    default:
      return null;
  }
}

/** Whether a type's label comes from a name rather than from grouping. */
export function isNamed(type: EditableType, names: Record<string, string>): boolean {
  return type.patterns.some((p) => Object.hasOwn(names, p));
}

/** The name a type keeps when its patterns get names: its label, minus the "(+N)" count. */
export function typeName(type: EditableType, names: Record<string, string>): string {
  return isNamed(type, names) ? type.label : withoutPatternCount(type.label);
}

/** A grouped type's label without its "(+N)" count of extra patterns. */
export function withoutPatternCount(label: string): string {
  return label.replace(/ \(\+\d+\)$/, '');
}

/** The name changes an edit makes, or a message saying why it can't be made. */
export function planPageTypeEdit(
  types: EditableType[],
  names: Record<string, string>,
  edit: PageTypeEdit,
): NameChanges | { error: string } {
  const type = types.find((t) => t.id === edit.typeId);
  if (!type) return { error: 'That page type no longer exists. Reload and try again.' };
  const all = (patterns: string[], name: string) =>
    Object.fromEntries(patterns.map((p) => [p, name]));

  switch (edit.kind) {
    case 'rename': {
      const name = edit.name.trim().replace(/\s+/g, ' ');
      if (!name) return { error: 'Enter a name.' };
      if (name.length > MAX_TYPE_NAME)
        return { error: `Use ${MAX_TYPE_NAME} characters or fewer.` };
      return { set: all(type.patterns, name), clear: [] };
    }
    case 'merge': {
      const target = types.find((t) => t.id === edit.into);
      if (!target || target.id === type.id) return { error: 'Choose another page type.' };
      const name = typeName(target, names);
      return { set: all([...target.patterns, ...type.patterns], name), clear: [] };
    }
    case 'split': {
      if (!type.patterns.includes(edit.pattern) || type.patterns.length < 2)
        return { error: 'That pattern can’t be split out of this type.' };
      const rest = type.patterns.filter((p) => p !== edit.pattern);
      return {
        set: { ...all(rest, typeName(type, names)), [edit.pattern]: edit.pattern },
        clear: [],
      };
    }
    case 'reset':
      return { set: {}, clear: type.patterns.filter((p) => Object.hasOwn(names, p)) };
  }
}

function positiveInt(value: FormDataEntryValue | null): number | null {
  const n = Number(value);
  return typeof value === 'string' && Number.isSafeInteger(n) && n > 0 ? n : null;
}
