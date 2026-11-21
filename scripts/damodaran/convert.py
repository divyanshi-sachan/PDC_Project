"""
Convert Aswath Damodaran's US industry beta workbook (betas.xls, "Industry Averages" sheet) into the JSON
snapshot DealPilot loads at runtime: packages/market/data/damodaran-betas-us.json

Source:  https://pages.stern.nyu.edu/~adamodar/pc/datasets/betas.xls   (updated once a year, each January)
Usage:   uv run --isolated --with xlrd python -I scripts/damodaran/convert.py <betas.xls> <out.json>

Treat the download as untrusted: keep it in its own directory and parse it with `python -I`.
Cite the source and date wherever the figures are shown; show only the figures used, do not rehost the workbook.
"""

import json
import sys
from datetime import datetime, timedelta, timezone

import xlrd

SOURCE_URL = "https://pages.stern.nyu.edu/~adamodar/pc/datasets/betas.xls"
HEADER = "Industry Name"


def excel_date(serial: float) -> str:
    return (datetime(1899, 12, 30) + timedelta(days=serial)).date().isoformat()


def number(v: object) -> float | None:
    return float(v) if isinstance(v, (int, float)) and v == v else None


def main(src: str, out: str) -> None:
    wb = xlrd.open_workbook(src)
    sh = wb.sheet_by_name("Industry Averages")

    updated = excel_date(float(sh.cell_value(0, 1)))
    header_row = next(r for r in range(sh.nrows) if str(sh.cell_value(r, 0)).strip() == HEADER)
    cols = [str(c).strip() for c in sh.row_values(header_row)]
    idx = {name: cols.index(name) for name in ("Number of firms", "Beta", "D/E Ratio", "Effective Tax rate", "Unlevered beta")}
    corrected = next(i for i, c in enumerate(cols) if c.startswith("Unlevered beta corrected"))

    industries = []
    for r in range(header_row + 1, sh.nrows):
        name = str(sh.cell_value(r, 0)).strip()
        if not name:
            continue
        row = sh.row_values(r)
        beta, de, tax, unlev, unlev_cash = (
            number(row[idx["Beta"]]),
            number(row[idx["D/E Ratio"]]),
            number(row[idx["Effective Tax rate"]]),
            number(row[idx["Unlevered beta"]]),
            number(row[corrected]),
        )
        firms = number(row[idx["Number of firms"]])
        if None in (beta, de, unlev, unlev_cash) or not firms:
            continue
        industries.append(
            {
                "name": name,
                "firms": int(firms),
                "beta": beta,
                "debtToEquity": de,
                "effectiveTaxRate": tax,
                "unleveredBeta": unlev,
                "unleveredBetaCorrectedForCash": unlev_cash,
            }
        )

    if len(industries) < 50:
        raise SystemExit(f"only {len(industries)} industries parsed; the workbook layout may have changed")

    snapshot = {
        "source": SOURCE_URL,
        "dataset": "Damodaran Online, US industry betas (January update)",
        "updated": updated,
        "convertedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "Industry betas, not company betas. Unlevered beta corrected for cash is the pure-play operating beta to relever.",
        "industries": industries,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {out}: {len(industries)} industries, updated {updated}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
