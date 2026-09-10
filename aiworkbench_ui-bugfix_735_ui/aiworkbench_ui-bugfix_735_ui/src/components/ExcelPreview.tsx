import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';

interface ExcelPreviewProps {
  blob: Blob;
}

interface FortuneSheetData {
  name: string;
  index: string;
  status: number;
  order: number;
  row: number;
  column: number;
  celldata: Array<{
    r: number;
    c: number;
    v: unknown;
  }>;
}

function convertWorkbook(
  workbook: XLSX.WorkBook
): FortuneSheetData[] {
  return workbook.SheetNames.map(
    (sheetName, index) => {
      const worksheet =
        workbook.Sheets[sheetName];

      const range = worksheet['!ref']
        ? XLSX.utils.decode_range(
            worksheet['!ref']
          )
        : {
            s: { r: 0, c: 0 },
            e: { r: 0, c: 0 },
          };

      const celldata: FortuneSheetData['celldata'] =
        [];

      for (
        let row = range.s.r;
        row <= range.e.r;
        row++
      ) {
        for (
          let column = range.s.c;
          column <= range.e.c;
          column++
        ) {
          const address = XLSX.utils.encode_cell({
            r: row,
            c: column,
          });

          const cell = worksheet[address];

          if (!cell) {
            continue;
          }

          celldata.push({
            r: row,
            c: column,
            v: {
              v: cell.v,
              m:
                cell.w ??
                String(cell.v ?? ''),
              ct: cell.z
                ? {
                    fa: cell.z,
                    t: 'n',
                  }
                : undefined,
            },
          });
        }
      }

      return {
        name: sheetName,
        index: String(index),
        status: 1,
        order: index,
        row: Math.max(range.e.r + 1, 20),
        column: Math.max(range.e.c + 1, 10),
        celldata,
      };
    }
  );
}

export default function ExcelPreview({
  blob,
}: ExcelPreviewProps) {
  const [sheets, setSheets] = useState<
    FortuneSheetData[] | null
  >(null);

  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadExcel() {
      try {
        setError('');
        setSheets(null);

        const buffer =
          await blob.arrayBuffer();

        const workbook =
          XLSX.read(buffer, {
            type: 'array',
            cellStyles: true,
            cellNF: true,
            cellDates: true,
          });

        const data =
          convertWorkbook(workbook);

        if (!cancelled) {
          setSheets(data);
        }
      } catch (err) {
        console.error(
          'Excel preview failed:',
          err
        );

        if (!cancelled) {
          setError(
            'Unable to render this Excel file.'
          );
        }
      }
    }

    void loadExcel();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!sheets) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading Excel preview...
      </div>
    );
  }

  return (
    <div className="h-[68vh] w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Workbook data={sheets as any} />
    </div>
  );
}