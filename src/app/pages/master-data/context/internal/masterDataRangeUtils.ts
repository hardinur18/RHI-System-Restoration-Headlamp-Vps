export type OrderDateRequest = {
  from?: string;
  to?: string;
  mode?: 'service' | 'lead' | 'created';
  technicianId?: string;
};

export const mapFetchedRows = (rows: any[], mapper?: (data: any[]) => any[]) =>
  mapper ? mapper(rows) : [...rows];

export const mergeRowsById = (nextRows: any[], previousRows: any[]) => {
  const seen = new Set(nextRows.map((row) => row?.id).filter(Boolean));
  return [
    ...nextRows,
    ...previousRows.filter((row) => row?.id && !seen.has(row.id)),
  ];
};

export const toBusinessDayUtcRange = (fromDateKey: string, toDateKey = fromDateKey) => {
  const parseDateKey = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return { year, month, day };
  };
  const fromParts = parseDateKey(fromDateKey);
  const toParts = parseDateKey(toDateKey);
  const jakartaOffsetMs = 7 * 60 * 60 * 1000;
  const startMs = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day, 0, 0, 0, 0) - jakartaOffsetMs;
  const endMs = Date.UTC(toParts.year, toParts.month - 1, toParts.day, 23, 59, 59, 999) - jakartaOffsetMs;

  return {
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(endMs).toISOString(),
  };
};
