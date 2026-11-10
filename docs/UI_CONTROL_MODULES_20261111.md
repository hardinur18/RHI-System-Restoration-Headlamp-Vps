# UI control audit and shared modules — 11 November 2026

Scope: presentation only. Business handlers, permissions, data fetching, routing and API contracts are unchanged.

## Findings and implementation

The Marketing Monitoring header mixed a compact `Button` with standard buttons. Page-specific CSS also forced 40/42px mobile controls, while filters used 38/44px. These overrides could disagree even when all controls used the same React component.

- `styles/controls.css` owns height (44px standard, 36px compact, 48px large), radius (10px), action gap (8px) and field gap (12px). Existing theme aliases use these tokens. Compact controls expand to 44px on coarse pointers.
- `ActionGroup` is a native div wrapper that forwards props/ref and normalizes adjacent controls. Shared page-header actions, dialog footers, confirmation footers and CS actions use it.
- `FilterRow` is the responsive filter wrapper. Existing fields, handlers, class hooks and child order are preserved; 17 div filter rows were migrated, bringing usage to 20 sites including existing modules.
- Shared page headers wrap on narrow screens instead of squeezing actions into fixed-width icon slots. Marketing Monitoring uses the same action module for header and month navigation.
- Inputs reserve space for their own search icon. Buttons, inputs and selects within a control group have matching border-box height.
- Alert confirmation actions support the shared semantic variant. Twenty existing red/rose actions explicitly use `danger`; destructive intent stays visible.
- Calendar cells, selectable cards, tabs, menus and custom native controls are not blindly converted into action buttons.

## Repeatable inventory

Run `node scripts/audit-ui-controls.mjs` from the repository root. Output is JSON containing per-file counts and local sizing locations; it reads source only and never connects to a backend.

The inventory scanned 177 TSX files: 488 Button usages, 146 native button tags, 239 Input usages, and 611 Select/SelectTrigger usages. Select counts include roots and triggers, not unique rendered fields. There are 283 local sizing sites; these are an inventory for review, not 283 confirmed defects. Many are intentional table, icon, calendar or specialized controls. The shared group contract takes precedence for standard action/filter rows.

## Verification

- Phase-4 typecheck covers core, inventory, finance, orders, ads and technicians.
- Source comparison verified 2,254 behavior-related JSX attributes across 31 changed TSX files are identical to the previous commit (`on*`, value, checked, disabled, name, type, href and to).
- Safari component fixture uses actual production components and built application CSS, isolated from all business APIs. Viewport widths measured 388, 818 and 1278px; each displayed 17 grouped controls at 44px with no document horizontal overflow.
- Visually checked light/dark variants, header wrapping, filter rows, icon alignment, loading/disabled states, compact standalone button, form footer and destructive confirmation footer.
- Exercised button clicks, text entry, branch selection and Escape-to-close in the fixture.

Limits: this is a source-wide inventory plus shared-component visual verification, not a claim that every authenticated screen or physical phone/PWA has been manually tested. Legacy page CSS remains behind the shared sizing boundary; removing all legacy rules is a separate, higher-risk rewrite.

## Usage contract

```tsx
<ActionGroup>
  <Button variant="outline">Batal</Button>
  <Button>Simpan</Button>
</ActionGroup>
<FilterRow>
  <Input aria-label="Cari" />
  <Select>
    <SelectTrigger aria-label="Cabang"><SelectValue placeholder="Cabang" /></SelectTrigger>
    {/* SelectContent and options */}
  </Select>
</FilterRow>
```

Use Button variants for intent, and `size="sm"` only for standalone compact/table controls. Avoid page-specific height, padding, gradient or font overrides on standard action rows. Keep specialized layout classes for field proportions and responsive disclosure. Shared wrappers add no hooks, network requests or dependencies.
