import type { Paged } from '@bcis/shared';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { QueryParams } from '../../../shared/bridge';
import { saveCsv, useApi } from '../lib/api';
import { count } from '../lib/format';
import { Button, cn, EmptyState, Input, Select } from './ui';

export type Column<T> = ColumnDef<T, unknown> & {
  /** Right-align with tabular numerals (money and counts). */
  num?: boolean;
  /** Plain value for CSV export; defaults to the accessor value. */
  csv?: (row: T) => string | number | null | undefined;
};

interface DataTableProps<T> {
  /** List endpoint returning Paged<T>; search, sort and paging are done by the server. */
  endpoint: string;
  columns: Column<T>[];
  params?: QueryParams;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  onRowClick?: (row: T) => void;
  exportName?: string;
  emptyTitle?: string;
  pageSize?: number;
  /** Rendered between toolbar and table, e.g. totals for the current filter. */
  summary?: (data: Paged<T>) => ReactNode;
  defaultSort?: { id: string; desc: boolean };
  className?: string;
}

function useDebounced<V>(value: V, delay = 250): V {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Dense operational table: sticky header, server-side search/sort/pagination,
 * filter slot, CSV export of the visible page and keyboard-accessible rows.
 */
export function DataTable<T>({ endpoint, columns, params, searchPlaceholder, filters, actions, onRowClick, exportName, emptyTitle = 'No records found', pageSize: initialPageSize = 25, summary, defaultSort, className }: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sorting, setSorting] = useState<SortingState>(defaultSort ? [defaultSort] : []);
  const q = useDebounced(search.trim());
  const paramsKey = JSON.stringify(params ?? {});
  useEffect(() => {
    setPage(1);
  }, [q, paramsKey, pageSize]);

  const query = useMemo<QueryParams>(
    () => ({ ...params, page, pageSize, q: q || undefined, sort: sorting[0]?.id, dir: sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paramsKey, page, pageSize, q, sorting],
  );
  const { data, isFetching, error } = useApi<Paged<T>>(endpoint, query);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const exportCsv = () => {
    const exportable = columns.filter((c) => typeof c.header === 'string' && c.header);
    const value = (col: Column<T>, row: T) => (col.csv ? col.csv(row) : 'accessorKey' in col && col.accessorKey ? ((row as Record<string, unknown>)[col.accessorKey as string] as string | number | null) : '');
    void saveCsv(`${exportName}.csv`, exportable.map((c) => c.header as string), rows.map((row) => exportable.map((c) => value(c, row))));
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-surface', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {searchPlaceholder && (
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="Search" />
          </div>
        )}
        {filters}
        <div className="ml-auto flex items-center gap-2">
          {isFetching && <span className="text-xs text-muted">Updating…</span>}
          {exportName && (
            <Button size="sm" onClick={exportCsv} disabled={!rows.length} title="Export the rows shown to CSV">
              <Download /> CSV
            </Button>
          )}
          {actions}
        </div>
      </div>
      {data && summary?.(data)}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const col = header.column.columnDef as Column<T>;
                  const sorted = header.column.getIsSorted();
                  const sortable = header.column.getCanSort() && col.enableSorting !== false && !!col.header;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                      className={cn('sticky top-0 z-10 border-b border-line bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-600', col.num && 'text-right')}
                    >
                      {sortable ? (
                        <button type="button" onClick={header.column.getToggleSortingHandler()} className={cn('inline-flex items-center gap-1 hover:text-ink', col.num && 'flex-row-reverse')}>
                          {flexRender(col.header, header.getContext())}
                          {sorted === 'asc' ? <ArrowUp className="size-3" /> : sorted === 'desc' ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 text-slate-400" />}
                        </button>
                      ) : (
                        flexRender(col.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row.original) : undefined}
                className={cn('group', onRowClick && 'cursor-pointer hover:bg-accent-50/60 focus-visible:bg-accent-50')}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={cn('border-b border-line px-3 py-1.5 align-middle', (cell.column.columnDef as Column<T>).num && 'num')}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {error && <EmptyState title="The list could not be loaded" description={error.message} />}
        {!error && data && rows.length === 0 && <EmptyState title={emptyTitle} description={q ? 'Try a different search term or clear the filters.' : undefined} />}
        {!data && !error && <div className="py-10 text-center text-sm text-muted">Loading…</div>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-xs text-muted">
        <span>{total === 0 ? 'No records' : `${count((page - 1) * pageSize + 1)}–${count(Math.min(page * pageSize, total))} of ${count(total)}`}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            Rows
            <Select className="h-7 w-20 text-xs" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </label>
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="tabular-nums">
            Page {page} of {count(pageCount)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={page >= pageCount} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Labelled filter dropdown used in table toolbars. */
export function FilterSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (value: string) => void; options: { value: string | number; label: string }[]; className?: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn('w-auto min-w-36', className)}>
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
