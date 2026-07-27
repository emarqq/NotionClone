import {
  Type,
  Hash,
  CheckSquare,
  ChevronDownCircle,
  List,
  CircleDot,
  Calendar,
  type LucideIcon,
} from "lucide-react";
import type { DbPropertyType } from "@/lib/db/types";

/** The 7 property types, in the order they're offered when adding a column. */
export const PROPERTY_TYPES: { type: DbPropertyType; label: string; icon: LucideIcon }[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "number", label: "Number", icon: Hash },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare },
  { type: "select", label: "Select", icon: ChevronDownCircle },
  { type: "multi_select", label: "Multi-select", icon: List },
  { type: "status", label: "Status", icon: CircleDot },
  { type: "date", label: "Date", icon: Calendar },
];

export const PROPERTY_TYPE_ICONS: Record<DbPropertyType, LucideIcon> = PROPERTY_TYPES.reduce(
  (acc, p) => {
    acc[p.type] = p.icon;
    return acc;
  },
  {} as Record<DbPropertyType, LucideIcon>
);
