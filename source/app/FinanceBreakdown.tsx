"use client";

import { useState, type ReactNode } from "react";
import { formatCny, type FinanceEntry } from "@/lib/finance";
import { categoryGlyphs, expenseDetailCategory } from "@/lib/finance-categories";

type CategoryTotal = { category: string; amountCents: number };
const colors = ["#748e81", "#b79470", "#7a94aa", "#ae8691", "#9a91b0", "#9ca46e", "#c49678", "#789f9e", "#b6a171", "#9a8980"];
const categoryColor = (index: number) => colors[index] ?? `hsl(${index * 137.5 % 360} 28% 55%)`;

export function FinanceDistribution({ label, totals }: { label: string; totals: CategoryTotal[] }) {
  const total = totals.reduce((sum, item) => sum + item.amountCents, 0);
  let offset = 0;
  return <section className="panel financeDistribution" aria-label={label}>
    <div className="sectionHead"><h2>{label}</h2><span className="countChip">{totals.length} 类</span></div>
    {total ? <div className="financeDistributionBody">
      <div className="financeDonut" role="img" aria-label={`${label}，合计 ${formatCny(total)}；各分类金额与占比见右侧列表`}>
        <svg viewBox="0 0 120 120" aria-hidden="true">{totals.map((item, index) => {
          const share = item.amountCents / total * 100;
          const start = offset;
          offset += share;
          return <circle key={item.category} cx="60" cy="60" r="47" fill="none" stroke={categoryColor(index)} strokeWidth="14" pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 60 60)" />;
        })}</svg>
        <div><small>合计</small><strong>{formatCny(total)}</strong></div>
      </div>
      <ul className="financePieLegend">{totals.map((item, index) => <li key={item.category}>
        <i style={{ backgroundColor: categoryColor(index) }} aria-hidden="true" /><span>{item.category}</span><strong>{formatCny(item.amountCents)}</strong><small>{(item.amountCents / total * 100).toFixed(1)}%</small>
      </li>)}</ul>
    </div> : <div className="financeEmpty">本月暂无{label.startsWith("收入") ? "收入" : "支出"}。</div>}
  </section>;
}

export function FinanceCategorySection({ type, totals, entries, renderEntry }: {
  type: "income" | "expense";
  totals: CategoryTotal[];
  entries: FinanceEntry[];
  renderEntry: (entry: FinanceEntry, showDate?: boolean) => ReactNode;
}) {
  const label = type === "income" ? "收入" : "支出";
  const [sectionOpen, setSectionOpen] = useState(type === "expense");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const allExpanded = sectionOpen && totals.length > 0 && totals.every((item) => expandedCategories.has(item.category));
  const total = totals.reduce((sum, item) => sum + item.amountCents, 0);
  const groups = new Map<string, FinanceEntry[]>();
  entries.filter((entry) => entry.type === type).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).forEach((entry) => {
    const group = groups.get(entry.category) ?? [];
    group.push(entry);
    groups.set(entry.category, group);
  });
  return <details className="panel financeCategoryPanel" open={sectionOpen} onToggle={(event) => setSectionOpen(event.currentTarget.open)}>
    <summary className="financeSectionTitle"><div><h2>{label}分类</h2><div className="financeCategoryCaption"><span>{totals.length} 类 · {entries.filter((entry) => entry.type === type).length} 笔</span>{totals.length > 0 && <button type="button" className="financeCategoryExpandAll" aria-label={`${allExpanded ? "收起" : "展开"}全部${label}分类明细`} aria-expanded={allExpanded} onClick={(event) => {
      event.preventDefault(); event.stopPropagation();
      setSectionOpen(true);
      setExpandedCategories(allExpanded ? new Set() : new Set(totals.map((item) => item.category)));
    }}>{allExpanded ? "全部收起" : "全部展开"}</button>}</div></div><b className={type === "income" ? "incomeText" : "expenseText"}>{formatCny(total)}</b><i aria-hidden="true">⌄</i></summary>
    {totals.length ? <div className="financeCategoryList">{totals.map((item) => {
      const categoryEntries = groups.get(item.category) ?? [];
      const details = new Map<string, FinanceEntry[]>();
      categoryEntries.forEach((entry) => {
        const detail = type === "expense" ? expenseDetailCategory(entry) : entry.purpose || entry.note || entry.category;
        const group = details.get(detail) ?? [];
        group.push(entry);
        details.set(detail, group);
      });
      return <details className="financeCategoryItem" key={item.category} open={expandedCategories.has(item.category)} onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpandedCategories((current) => {
          if (current.has(item.category) === open) return current;
          const next = new Set(current);
          if (open) next.add(item.category); else next.delete(item.category);
          return next;
        });
      }}>
        <summary><span className="financeCategoryGlyph">{categoryGlyphs[item.category] || (type === "income" ? "收" : "记")}</span><span className="financeCategoryName"><strong>{item.category}</strong><small>{categoryEntries.length} 笔 · {(item.amountCents / total * 100).toFixed(1)}%</small></span><b>{formatCny(item.amountCents)}</b><i aria-hidden="true">⌄</i></summary>
        <div className="financeCategoryTransactions">{[...details].sort((a, b) => b[1].reduce((sum, entry) => sum + entry.amountCents, 0) - a[1].reduce((sum, entry) => sum + entry.amountCents, 0)).map(([detail, detailEntries]) => <div className="financeDetailGroup" key={detail}>
          {type === "expense" && <div className="financeDetailGroupHead"><strong>{detail}</strong><span>{detailEntries.length} 笔</span><b>{formatCny(detailEntries.reduce((sum, entry) => sum + entry.amountCents, 0))}</b></div>}
          {detailEntries.map((entry) => renderEntry(entry, true))}
        </div>)}</div>
      </details>;
    })}</div> : <div className="financeEmpty">本月还没有{label}记录。</div>}
  </details>;
}
