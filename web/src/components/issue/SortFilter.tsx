import { ArrowUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheck,
} from "@/components/ui/dropdown-menu";
import { useUi, type IssueSort } from "@/lib/ui-store";
import { pillTrigger } from "./pill";

const OPTIONS: IssueSort[] = [
  "activity",
  "created_desc",
  "created_asc",
  "priority",
  "unread",
];

// 需求页头部「排序」下拉。选择持久化在 ui-store（localStorage），列表与看板共用。
export function SortFilter() {
  const { t, issueSort, setIssueSort } = useUi();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pillTrigger}>
        <ArrowUpDown className="size-4 text-muted-foreground" />
        <span className="max-w-[120px] truncate">{t(`sort.${issueSort}`)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setIssueSort(opt)}>
            <span className="flex-1">{t(`sort.${opt}`)}</span>
            <DropdownMenuCheck active={issueSort === opt} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
