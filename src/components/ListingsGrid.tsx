"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  CalendarRange,
  LayoutGrid,
  List,
  Mail,
  MailCheck,
  MailX,
  Search,
  WashingMachine,
  X,
} from "lucide-react";
import type { Listing } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type SortKey = "newest" | "price_asc" | "price_desc";
type ViewMode = "cards" | "list";

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

const SOURCE_BRAND: Record<
  Listing["source"],
  { label: string; chip: string; chipActive: string; badge: string }
> = {
  heykorean: {
    label: "HeyKorean",
    chip: "border-[#F04E23]/45 text-[#F04E23] hover:bg-[#F04E23]/10 dark:border-[#F04E23]/55 dark:text-[#FF7A5C]",
    chipActive:
      "border-[#F04E23] bg-[#F04E23] text-white hover:bg-[#F04E23]/90 dark:border-[#F04E23] dark:bg-[#F04E23]",
    badge: "border-transparent bg-[#F04E23] text-white",
  },
  zillow: {
    label: "Zillow",
    chip: "border-[#006AFF]/45 text-[#006AFF] hover:bg-[#006AFF]/10 dark:border-[#006AFF]/55 dark:text-[#4DA3FF]",
    chipActive:
      "border-[#006AFF] bg-[#006AFF] text-white hover:bg-[#006AFF]/90 dark:border-[#006AFF] dark:bg-[#006AFF]",
    badge: "border-transparent bg-[#006AFF] text-white",
  },
  streeteasy: {
    label: "StreetEasy",
    chip: "border-[#00A652]/45 text-[#00A652] hover:bg-[#00A652]/10 dark:border-[#00A652]/55 dark:text-[#3DD68C]",
    chipActive:
      "border-[#00A652] bg-[#00A652] text-white hover:bg-[#00A652]/90 dark:border-[#00A652] dark:bg-[#00A652]",
    badge: "border-transparent bg-[#00A652] text-white",
  },
  craigslist: {
    label: "Craigslist",
    chip: "border-[#6E3299]/45 text-[#6E3299] hover:bg-[#6E3299]/10 dark:border-[#6E3299]/55 dark:text-[#B07FD4]",
    chipActive:
      "border-[#6E3299] bg-[#6E3299] text-white hover:bg-[#6E3299]/90 dark:border-[#6E3299] dark:bg-[#6E3299]",
    badge: "border-transparent bg-[#6E3299] text-white",
  },
  facebook: {
    label: "Facebook",
    chip: "border-[#1877F2]/45 text-[#1877F2] hover:bg-[#1877F2]/10 dark:border-[#1877F2]/55 dark:text-[#5B9DF5]",
    chipActive:
      "border-[#1877F2] bg-[#1877F2] text-white hover:bg-[#1877F2]/90 dark:border-[#1877F2] dark:bg-[#1877F2]",
    badge: "border-transparent bg-[#1877F2] text-white",
  },
  reddit: {
    label: "Reddit",
    chip: "border-[#FF4500]/45 text-[#FF4500] hover:bg-[#FF4500]/10 dark:border-[#FF4500]/55 dark:text-[#FF7A50]",
    chipActive:
      "border-[#FF4500] bg-[#FF4500] text-white hover:bg-[#FF4500]/90 dark:border-[#FF4500] dark:bg-[#FF4500]",
    badge: "border-transparent bg-[#FF4500] text-white",
  },
  listingsproject: {
    // Listings Project's brand teal.
    label: "Listings Project",
    chip: "border-[#0D8A8A]/45 text-[#0D8A8A] hover:bg-[#0D8A8A]/10 dark:border-[#0D8A8A]/55 dark:text-[#3FC1C1]",
    chipActive:
      "border-[#0D8A8A] bg-[#0D8A8A] text-white hover:bg-[#0D8A8A]/90 dark:border-[#0D8A8A] dark:bg-[#0D8A8A]",
    badge: "border-transparent bg-[#0D8A8A] text-white",
  },
};

const SOURCE_KEYS = Object.keys(SOURCE_BRAND) as Listing["source"][];

const BOROUGH_KEYS = [
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten island",
] as const;

const BOROUGH_LABELS: Record<(typeof BOROUGH_KEYS)[number], string> = {
  manhattan: "Manhattan",
  brooklyn: "Brooklyn",
  queens: "Queens",
  bronx: "Bronx",
  "staten island": "Staten Island",
};

const LISTING_TYPE_KEYS = ["apartment", "room", "sublet"] as const;

const LISTING_TYPE_LABELS: Record<(typeof LISTING_TYPE_KEYS)[number], string> =
  {
    apartment: "Apartments",
    room: "Rooms",
    sublet: "Sublets",
  };

/**
 * Options for the sublet period filter: the next 12 months. Values are
 * "YYYY-MM"; labels like "Aug 2026".
 */
function buildMonthOptions(): Array<{ value: string; label: string }> {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    return { value, label };
  });
}

const PRICE_SLIDER_MIN = 0;
const PRICE_SLIDER_MAX = 3000;
const PRICE_SLIDER_STEP = 50;
const DEFAULT_PRICE_RANGE: [number, number] = [0, 2000];
const PAGE_SIZE_OPTIONS = [8, 24, 60, 100] as const;
const DISPLAY_COUNT_LABELS: Record<string, string> = {
  "8": "8",
  "24": "24",
  "60": "60",
  "100": "100",
};

const FILTER_STORAGE_KEY = "listings-filters";

/**
 * Listings the user marked as "already emailed", kept in localStorage only
 * (no account needed). Maps "source:ext_id" to the ISO time it was marked.
 */
const CONTACTED_STORAGE_KEY = "contacted-listings";

function listingKey(l: Listing): string {
  return `${l.source}:${l.ext_id}`;
}

function readContacted(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CONTACTED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

type SavedFilters = {
  /** Empty array = no filter (show all). */
  sources: string[];
  boroughs: string[];
  listingTypes: string[];
  categories: string[];
  /** Show only listings with confirmed in-unit washer/dryer. */
  laundryOnly: boolean;
  /** "YYYY-MM": show only sublets whose window covers that month. */
  subletMonth: string | null;
  /** Hide listings the user marked as already emailed. */
  hideEmailed: boolean;
  sort: SortKey;
  priceRange: [number, number];
  view: ViewMode;
  pageSize: number;
};

const DEFAULT_FILTERS: SavedFilters = {
  sources: [],
  boroughs: [],
  listingTypes: [],
  categories: [],
  laundryOnly: false,
  subletMonth: null,
  hideEmailed: false,
  sort: "newest",
  priceRange: DEFAULT_PRICE_RANGE,
  view: "cards",
  pageSize: 24,
};

function clampPrice(n: number): number {
  return Math.min(
    PRICE_SLIDER_MAX,
    Math.max(
      PRICE_SLIDER_MIN,
      Math.round(n / PRICE_SLIDER_STEP) * PRICE_SLIDER_STEP,
    ),
  );
}

function normalizePriceRange(raw: unknown): [number, number] {
  if (Array.isArray(raw) && raw.length === 2) {
    const lo = clampPrice(Number(raw[0]));
    const hi = clampPrice(Number(raw[1]));
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return lo <= hi ? [lo, hi] : [hi, lo];
    }
  }
  return DEFAULT_PRICE_RANGE;
}

function readPriceRange(
  parsed: Partial<SavedFilters> & { capPrice?: boolean },
): [number, number] {
  if (parsed.priceRange) return normalizePriceRange(parsed.priceRange);
  // Migrate saved settings from the old Under $2,000 toggle.
  if (typeof parsed.capPrice === "boolean") {
    return parsed.capPrice
      ? DEFAULT_PRICE_RANGE
      : [PRICE_SLIDER_MIN, PRICE_SLIDER_MAX];
  }
  return DEFAULT_PRICE_RANGE;
}

/**
 * Reads a saved multi-select value. Accepts the old single-string format
 * ("all" or one value) and migrates it to an array.
 */
function readSelection(multi: unknown, legacy: unknown): string[] {
  if (Array.isArray(multi)) {
    return multi.filter((v): v is string => typeof v === "string");
  }
  if (typeof legacy === "string" && legacy !== "all") return [legacy];
  return [];
}

function readSavedFilters(): SavedFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<SavedFilters> & {
      source?: string;
      borough?: string;
      category?: string;
    };
    return {
      sources: readSelection(parsed.sources, parsed.source).filter((v) =>
        SOURCE_KEYS.includes(v as Listing["source"]),
      ),
      boroughs: readSelection(parsed.boroughs, parsed.borough).filter((v) =>
        BOROUGH_KEYS.includes(v as (typeof BOROUGH_KEYS)[number]),
      ),
      listingTypes: readSelection(parsed.listingTypes, undefined).filter((v) =>
        LISTING_TYPE_KEYS.includes(v as (typeof LISTING_TYPE_KEYS)[number]),
      ),
      categories: readSelection(parsed.categories, parsed.category),
      laundryOnly: parsed.laundryOnly === true,
      // A saved month that's no longer offered (it passed) is dropped.
      subletMonth: buildMonthOptions().some((m) => m.value === parsed.subletMonth)
        ? (parsed.subletMonth as string)
        : null,
      hideEmailed: parsed.hideEmailed === true,
      sort:
        parsed.sort === "newest" ||
        parsed.sort === "price_asc" ||
        parsed.sort === "price_desc"
          ? parsed.sort
          : DEFAULT_FILTERS.sort,
      priceRange: readPriceRange(parsed),
      view: parsed.view === "list" ? "list" : "cards",
      pageSize: PAGE_SIZE_OPTIONS.includes(
        parsed.pageSize as (typeof PAGE_SIZE_OPTIONS)[number],
      )
        ? (parsed.pageSize as number)
        : DEFAULT_FILTERS.pageSize,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/**
 * Every whitespace-separated word in the query must appear somewhere in the
 * listing's title or address, so "astoria 2br" matches "2BR apartment in
 * Astoria".
 */
function matchesSearch(listing: Listing, words: string[]): boolean {
  const haystack =
    `${listing.title ?? ""} ${listing.address ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Fixed locale and timezone so the server-rendered HTML matches the client
 * hydration output regardless of the visitor's system settings. It's a NYC
 * site, so Eastern time is the natural choice anyway.
 */
function formatLastUpdated(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function ListingsGrid({
  listings,
  lastUpdated,
}: {
  listings: Listing[];
  lastUpdated?: string | null;
}) {
  const [filters, setFilters] = useState<SavedFilters>(DEFAULT_FILTERS);
  const [contacted, setContacted] = useState<Record<string, string>>({});
  const contactedHydrated = useRef(false);
  const [page, setPage] = useState(1);
  // Search is deliberately not persisted to localStorage: a stale query from
  // a previous visit silently hiding most listings would be confusing.
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const filtersHydrated = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  // Base UI's Select needs a value->label record to render the trigger text.
  const monthItems = useMemo(() => {
    const items: Record<string, string> = { any: "Sublet dates: any" };
    for (const m of monthOptions) items[m.value] = `Sublets in ${m.label}`;
    return items;
  }, [monthOptions]);

  // Debounce so filtering (and page reset) doesn't run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery((prev) => {
        if (prev !== searchInput) setPage(1);
        return searchInput;
      });
    }, 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    // Hydrate filter UI from localStorage after mount (avoids SSR mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only hydration from localStorage
    setFilters(readSavedFilters());
    filtersHydrated.current = true;
  }, []);

  useEffect(() => {
    const saved = readContacted();
    // Drop marks for listings that no longer exist (pruned from the
    // database); they can't come back, and this keeps the store small.
    const current = new Set(listings.map(listingKey));
    const pruned = Object.fromEntries(
      Object.entries(saved).filter(([key]) => current.has(key)),
    );
    // Merge under any marks made before this effect ran (e.g. fast clicks).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only hydration from localStorage
    setContacted((prev) => ({ ...pruned, ...prev }));
    contactedHydrated.current = true;
  }, [listings]);

  useEffect(() => {
    if (!contactedHydrated.current) return;
    localStorage.setItem(CONTACTED_STORAGE_KEY, JSON.stringify(contacted));
  }, [contacted]);

  const {
    sources,
    boroughs: selectedBoroughs,
    listingTypes: selectedListingTypes,
    categories: selectedCategories,
    laundryOnly,
    subletMonth,
    hideEmailed,
    sort,
    priceRange,
    view,
    pageSize,
  } = filters;
  const toggleSource = (value: string) => {
    setFilters((f) => ({ ...f, sources: toggleValue(f.sources, value) }));
    setPage(1);
  };
  const clearSources = () => {
    setFilters((f) => ({ ...f, sources: [] }));
    setPage(1);
  };
  const toggleBorough = (value: string) => {
    setFilters((f) => ({ ...f, boroughs: toggleValue(f.boroughs, value) }));
    setPage(1);
  };
  const clearBoroughs = () => {
    setFilters((f) => ({ ...f, boroughs: [] }));
    setPage(1);
  };
  const toggleListingType = (value: string) => {
    setFilters((f) => ({
      ...f,
      listingTypes: toggleValue(f.listingTypes, value),
    }));
    setPage(1);
  };
  const clearListingTypes = () => {
    setFilters((f) => ({ ...f, listingTypes: [] }));
    setPage(1);
  };
  const toggleLaundryOnly = () => {
    setFilters((f) => ({ ...f, laundryOnly: !f.laundryOnly }));
    setPage(1);
  };
  const setSubletMonth = (value: string | null) => {
    setFilters((f) => ({ ...f, subletMonth: value }));
    setPage(1);
  };
  const toggleHideEmailed = () => {
    setFilters((f) => ({ ...f, hideEmailed: !f.hideEmailed }));
    setPage(1);
  };
  const toggleContacted = (key: string) => {
    setContacted((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = new Date().toISOString();
      return next;
    });
  };
  const toggleCategory = (value: string) => {
    setFilters((f) => ({ ...f, categories: toggleValue(f.categories, value) }));
    setPage(1);
  };
  const clearCategories = () => {
    setFilters((f) => ({ ...f, categories: [] }));
    setPage(1);
  };
  const setSort = (value: SortKey) => {
    setFilters((f) => ({ ...f, sort: value }));
    setPage(1);
  };
  const setPriceRange = (value: number | readonly number[]) => {
    if (typeof value === "number") return;
    const range = normalizePriceRange([...value]);
    setFilters((f) => ({ ...f, priceRange: range }));
    setPage(1);
  };
  const setView = (value: ViewMode) => {
    setFilters((f) => ({ ...f, view: value }));
  };
  const setPageSize = (value: number) => {
    setFilters((f) => ({ ...f, pageSize: value }));
    setPage(1);
  };

  // Search runs first so every downstream count (borough, source, type chips)
  // reflects the query.
  const bySearch = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return listings;
    return listings.filter((l) => matchesSearch(l, words));
  }, [listings, query]);

  const emailedCount = useMemo(
    () => bySearch.filter((l) => contacted[listingKey(l)]).length,
    [bySearch, contacted],
  );

  // Applied early so every downstream chip count reflects the hidden rows.
  const byContacted = useMemo(() => {
    if (!hideEmailed) return bySearch;
    return bySearch.filter((l) => !contacted[listingKey(l)]);
  }, [bySearch, hideEmailed, contacted]);

  // Listings without a price are kept; they can't be proven to be out of range.
  const byPrice = useMemo(() => {
    const [min, max] = priceRange;
    const isFullRange = min <= PRICE_SLIDER_MIN && max >= PRICE_SLIDER_MAX;
    if (isFullRange) return byContacted;
    return byContacted.filter(
      (l) => l.price == null || (l.price >= min && l.price <= max),
    );
  }, [byContacted, priceRange]);

  // Rows scraped before the listing_type column existed count as apartments,
  // the overwhelmingly common case, until a scrape or backfill labels them.
  const listingTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of byPrice) {
      const type = l.listing_type ?? "apartment";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return LISTING_TYPE_KEYS.map(
      (key) => [key, counts.get(key) ?? 0] as const,
    ).filter(([, count]) => count > 0);
  }, [byPrice]);

  // Selections that reference options not currently available (e.g. a saved
  // borough with zero listings in the price range) are ignored, not deleted:
  // the raw selection stays in state/localStorage and re-applies when the
  // option comes back.
  const activeListingTypes = useMemo(() => {
    const available = new Set<string>(listingTypes.map(([key]) => key));
    return selectedListingTypes.filter((t) => available.has(t));
  }, [selectedListingTypes, listingTypes]);

  const byListingType = useMemo(() => {
    if (activeListingTypes.length === 0) return byPrice;
    const wanted = new Set(activeListingTypes);
    return byPrice.filter((l) => wanted.has(l.listing_type ?? "apartment"));
  }, [byPrice, activeListingTypes]);

  // Confirmed in-unit W/D only; null means unknown, so this is intentionally
  // a narrowing toggle rather than a yes/no facet.
  const laundryCount = useMemo(
    () => byListingType.filter((l) => l.laundry === "in_unit").length,
    [byListingType],
  );

  const byLaundry = useMemo(() => {
    if (!laundryOnly) return byListingType;
    return byListingType.filter((l) => l.laundry === "in_unit");
  }, [byListingType, laundryOnly]);

  // Sublet-style listings whose availability window covers the chosen month.
  // "Sublet-style" = typed as sublet OR carrying an explicit end date (e.g.
  // Listings Project rooms offered for a fixed window). A missing start date
  // means "available now" and a missing end date means open-ended, so both
  // count as covering.
  const byPeriod = useMemo(() => {
    if (!subletMonth) return byLaundry;
    const [y, m] = subletMonth.split("-").map(Number);
    const monthStart = Date.UTC(y, m - 1, 1);
    const monthEnd = Date.UTC(y, m, 0, 23, 59, 59);
    return byLaundry.filter((l) => {
      if (l.listing_type !== "sublet" && l.available_until == null)
        return false;
      if (l.write_dt && new Date(l.write_dt).getTime() > monthEnd) return false;
      if (
        l.available_until &&
        new Date(l.available_until).getTime() < monthStart
      )
        return false;
      return true;
    });
  }, [byLaundry, subletMonth]);

  const boroughs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of byPeriod) {
      if (!l.borough) continue;
      counts.set(l.borough, (counts.get(l.borough) ?? 0) + 1);
    }
    return BOROUGH_KEYS.map(
      (key) => [key, counts.get(key) ?? 0] as const,
    ).filter(([, count]) => count > 0);
  }, [byPeriod]);

  const activeBoroughs = useMemo(() => {
    const available = new Set<string>(boroughs.map(([key]) => key));
    return selectedBoroughs.filter((b) => available.has(b));
  }, [selectedBoroughs, boroughs]);

  const byBorough = useMemo(() => {
    if (activeBoroughs.length === 0) return byPeriod;
    const wanted = new Set(activeBoroughs);
    return byPeriod.filter((l) => l.borough != null && wanted.has(l.borough));
  }, [byPeriod, activeBoroughs]);

  const bySource = useMemo(() => {
    if (sources.length === 0) return byBorough;
    const wanted = new Set(sources);
    return byBorough.filter((l) => wanted.has(l.source));
  }, [byBorough, sources]);

  const categories = useMemo(() => {
    const names = new Map<string, number>();
    for (const l of bySource) {
      const name = l.category ?? "Other";
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    return [...names.entries()].sort((a, b) => b[1] - a[1]);
  }, [bySource]);

  const activeCategories = useMemo(() => {
    const available = new Set(categories.map(([name]) => name));
    return selectedCategories.filter((c) => available.has(c));
  }, [selectedCategories, categories]);

  useEffect(() => {
    if (!filtersHydrated.current) return;
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const visible = useMemo(() => {
    let result = bySource;
    if (activeCategories.length > 0) {
      const wanted = new Set(activeCategories);
      result = result.filter((l) => wanted.has(l.category ?? "Other"));
    }
    return [...result].sort((a, b) => {
      if (sort === "price_asc")
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === "price_desc")
        return (b.price ?? -Infinity) - (a.price ?? -Infinity);
      const at = a.write_dt ? new Date(a.write_dt).getTime() : 0;
      const bt = b.write_dt ? new Date(b.write_dt).getTime() : 0;
      return bt - at;
    });
  }, [bySource, activeCategories, sort]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of byBorough) counts[l.source] = (counts[l.source] ?? 0) + 1;
    return counts;
  }, [byBorough]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = visible.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
    // Scroll to the top of the results, not the page: on mobile the header,
    // search box, and filter rows would otherwise sit between the user and
    // the listings after every page change.
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl theme8bit:uppercase theme8bit:tracking-widest theme8bit:text-[#f4d35e] theme8bit:text-lg sm:theme8bit:text-xl theme8bit:[font-family:var(--font-pixel)]">
            <SiteLogo className="h-7 w-7 shrink-0 sm:h-8 sm:w-8 theme8bit:rounded-none" />
            JR&apos;s List (Beta)
          </h1>
          <p className="mt-1 text-sm text-muted-foreground theme8bit:[font-family:var(--font-pixel)] theme8bit:leading-relaxed">
            <span className="text-red-600 dark:text-red-400">
              {listings.length}{" "}
            </span>{" "}
            NYC housing listings, mostly{" "}
            <span className="text-red-600 dark:text-red-400">under $3000.</span>
          </p>
          {lastUpdated && formatLastUpdated(lastUpdated) && (
            <p className="mt-1 text-xs text-muted-foreground/80 theme8bit:[font-family:var(--font-pixel)]">
              Last updated {formatLastUpdated(lastUpdated)}
            </p>
          )}
        </div>
        <a
          href="https://www.linkedin.com/in/jung-rae-jang/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Laid-off dev looking for a job — visit LinkedIn profile"
          className="shrink-0 transition-opacity hover:opacity-90 theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[4px_4px_0_#000]"
        >
          <Image
            src="/linkedin-post.png"
            alt="Laid-off dev looking for a job — click for LinkedIn"
            width={300}
            height={100}
            className="rounded-md border theme8bit:rounded-none"
          />
        </a>
      </header>

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search title or address…"
          aria-label="Search listings"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="rounded-none pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {searchInput && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearchInput("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <span className="shrink-0 text-sm font-medium text-muted-foreground theme8bit:[font-family:var(--font-pixel)] theme8bit:text-xs">
          Price ${priceRange[0].toLocaleString()} – $
          {priceRange[1].toLocaleString()}
        </span>
        <Slider
          className="w-full min-w-0 flex-1 theme8bit:**:data-[slot=slider-track]:rounded-none theme8bit:**:data-[slot=slider-thumb]:rounded-none"
          min={PRICE_SLIDER_MIN}
          max={PRICE_SLIDER_MAX}
          step={PRICE_SLIDER_STEP}
          minStepsBetweenValues={1}
          value={priceRange}
          onValueChange={setPriceRange}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={`All sources (${byBorough.length})`}
          active={sources.length === 0}
          onClick={clearSources}
        />
        {SOURCE_KEYS.map((key) => (
          <SourceFilterChip
            key={key}
            source={key}
            count={sourceCounts[key] ?? 0}
            active={sources.includes(key)}
            onClick={() => toggleSource(key)}
          />
        ))}
        <div className="ml-auto">
          <Select
            value={sort}
            items={SORT_LABELS}
            onValueChange={(value) => setSort(value as SortKey)}
          >
            <SelectTrigger className="w-[190px] rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(
                ([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={`All listings (${byPrice.length})`}
          active={activeListingTypes.length === 0}
          onClick={clearListingTypes}
        />
        {listingTypes.map(([key, count]) => (
          <FilterChip
            key={key}
            label={`${LISTING_TYPE_LABELS[key]} (${count})`}
            active={activeListingTypes.includes(key)}
            onClick={() => toggleListingType(key)}
          />
        ))}
        <Button
          variant={laundryOnly ? "default" : "outline"}
          size="sm"
          className="rounded-none"
          onClick={toggleLaundryOnly}
          title="Only listings with confirmed in-unit washer/dryer; unmarked listings may still have one."
        >
          <WashingMachine />
          W/D in unit ({laundryCount})
        </Button>
        <Button
          variant={hideEmailed ? "default" : "outline"}
          size="sm"
          className="rounded-none"
          onClick={toggleHideEmailed}
          title="Hide listings you've marked as emailed (the mail button on each listing). Marks are saved in this browser only."
        >
          <MailX />
          Hide emailed ({emailedCount})
        </Button>
        <div
          className="ml-auto"
          title="Show only sublets whose availability window covers the chosen month. Sublets without a stated end date count as open-ended."
        >
          <Select
            value={subletMonth ?? "any"}
            items={monthItems}
            onValueChange={(value) =>
              setSubletMonth(value === "any" ? null : (value as string))
            }
          >
            <SelectTrigger className="w-[190px] rounded-none">
              <CalendarRange className="size-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Sublet dates: any</SelectItem>
              {monthOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  Sublets in {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={`All locations (${byPeriod.length})`}
          active={activeBoroughs.length === 0}
          onClick={clearBoroughs}
        />
        {boroughs.map(([key, count]) => (
          <FilterChip
            key={key}
            label={`${BOROUGH_LABELS[key]} (${count})`}
            active={activeBoroughs.includes(key)}
            onClick={() => toggleBorough(key)}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <FilterChip
          label={`All types (${bySource.length})`}
          active={activeCategories.length === 0}
          onClick={clearCategories}
        />
        {categories.map(([name, count]) => (
          <FilterChip
            key={name}
            label={`${name} (${count})`}
            active={activeCategories.includes(name)}
            onClick={() => toggleCategory(name)}
          />
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            Display
          </span>
          <Select
            value={String(pageSize)}
            items={DISPLAY_COUNT_LABELS}
            onValueChange={(value) => setPageSize(Number(value))}
          >
            <SelectTrigger className="w-[72px] rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            variant="outline"
            value={[view]}
            onValueChange={(value) => {
              if (value[0]) setView(value[0] as ViewMode);
            }}
          >
            <ToggleGroupItem value="cards" aria-label="Card view">
              <LayoutGrid />
              Cards
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List />
              List
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div ref={resultsRef} className="scroll-mt-4">
        <ListingsPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={visible.length}
          onPageChange={goToPage}
          className="mb-6"
        />
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed py-16 text-center theme8bit:rounded-none">
          <p className="text-sm font-medium">No listings found</p>
          <p className="text-sm text-muted-foreground">
            Try a different search or loosen the filters.
          </p>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 theme8bit:gap-4 theme8bit:border-4 theme8bit:border-black theme8bit:p-2 theme8bit:shadow-[6px_6px_0_#000]">
          {pageItems.map((listing) => (
            <ListingCard
              key={listingKey(listing)}
              listing={listing}
              contactedAt={contacted[listingKey(listing)] ?? null}
              onToggleContacted={() => toggleContacted(listingKey(listing))}
            />
          ))}
        </div>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          {/* Fixed layout: column widths stay identical across pages and
              filters instead of shifting with the widest cell's content. */}
          <Table className="sm:table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[96px] sm:w-[112px]"></TableHead>
                <TableHead>Listing</TableHead>
                <TableHead className="hidden w-[120px] sm:table-cell">
                  Source
                </TableHead>
                <TableHead className="hidden w-[88px] sm:table-cell">
                  Type
                </TableHead>
                <TableHead className="hidden w-[232px] sm:table-cell">
                  Posted
                </TableHead>
                {/* The 8-bit pixel font is much wider, so the price column
                    gets extra room in that theme. */}
                <TableHead className="hidden w-[104px] theme8bit:w-[150px] sm:table-cell">
                  Price
                </TableHead>
                <TableHead className="w-[56px]">
                  <span className="sr-only">Emailed</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((listing) => (
                <ListingRow
                  key={listingKey(listing)}
                  listing={listing}
                  contactedAt={contacted[listingKey(listing)] ?? null}
                  onToggleContacted={() => toggleContacted(listingKey(listing))}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ListingsPagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={visible.length}
        onPageChange={goToPage}
        className="mt-8"
      />
    </div>
  );
}

/** Same artwork as src/app/icon.svg (the favicon), inlined so it scales crisply. */
function SiteLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="6" fill="#18181b" />
      <rect x="6" y="7" width="4" height="4" fill="#f59e0b" />
      <rect x="13" y="7" width="13" height="4" rx="1" fill="#fafafa" />
      <rect x="6" y="14" width="4" height="4" fill="#f59e0b" />
      <rect x="13" y="14" width="13" height="4" rx="1" fill="#fafafa" />
      <rect x="6" y="21" width="4" height="4" fill="#f59e0b" />
      <rect x="13" y="21" width="13" height="4" rx="1" fill="#fafafa" />
    </svg>
  );
}

function SourceFilterChip({
  source,
  count,
  active,
  onClick,
}: {
  source: Listing["source"];
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const brand = SOURCE_BRAND[source];
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "rounded-none border bg-transparent",
        active ? brand.chipActive : brand.chip,
      )}
      onClick={onClick}
    >
      {brand.label} ({count})
    </Button>
  );
}

function SourceBadge({
  source,
  className,
}: {
  source: Listing["source"];
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "font-medium",
        SOURCE_BRAND[source].badge,
        "theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[2px_2px_0_#000] theme8bit:backdrop-blur-none",
        className,
      )}
    >
      {SOURCE_BRAND[source].label}
    </Badge>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      className="rounded-none"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/**
 * Windowed page numbers with a CONSTANT number of slots (7 when there are
 * enough pages), so the control doesn't change width as the user moves
 * between pages. Near the edges the window is padded with page numbers
 * instead of collapsing:
 *   1 2 3 4 5 … 20   |   1 … 9 10 11 … 20   |   1 … 16 17 18 19 20
 */
function buildPageWindow(
  currentPage: number,
  totalPages: number,
): (number | "ellipsis")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }
  return [
    1,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    totalPages,
  ];
}

function ListingsPagination({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
  className,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const pages = buildPageWindow(currentPage, totalPages);

  const atStart = currentPage === 1;
  const atEnd = currentPage === totalPages;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              className={
                atStart ? "pointer-events-none opacity-40" : "cursor-pointer"
              }
              aria-disabled={atStart}
              onClick={(e) => {
                e.preventDefault();
                if (!atStart) onPageChange(currentPage - 1);
              }}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={p === currentPage}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    onPageChange(p);
                  }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              className={
                atEnd ? "pointer-events-none opacity-40" : "cursor-pointer"
              }
              aria-disabled={atEnd}
              onClick={(e) => {
                e.preventDefault();
                if (!atEnd) onPageChange(currentPage + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      <p className="text-xs text-muted-foreground">
        Page {currentPage} of {totalPages} · {totalItems.toLocaleString()}{" "}
        listings
      </p>
    </div>
  );
}

function formatPosted(write_dt: string | null): string | null {
  if (!write_dt) return null;
  return new Date(write_dt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** UTC keeps end-of-month dates stored at UTC midnight on the right day. */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/**
 * The date shown next to a listing. For listings with a known end date this
 * is the availability window: Listings Project's listing date is the actual
 * start date so it shows a full range, while other sources only know the
 * end ("Until Oct 31").
 */
function formatListingDate(listing: Listing): string | null {
  if (listing.available_until) {
    const until = formatDay(listing.available_until);
    if (listing.source === "listingsproject" && listing.write_dt) {
      return `${formatDay(listing.write_dt)} – ${until}`;
    }
    return `Until ${until}`;
  }
  return formatPosted(listing.write_dt);
}

/**
 * A date in the future means the listing isn't available yet (StreetEasy
 * uses the availability date as the listing date).
 */
function isComingSoon(write_dt: string | null): boolean {
  if (!write_dt) return false;
  return new Date(write_dt).getTime() > Date.now();
}

/**
 * Room/sublet marker. Whole-unit rentals (the default) get no badge, and the
 * badge is skipped when the category badge already carries the same word.
 */
function ListingTypeBadge({
  listing,
  className,
}: {
  listing: Listing;
  className?: string;
}) {
  const type = listing.listing_type;
  if (type !== "room" && type !== "sublet") return null;
  if (type === "room" && listing.category === "Room") return null;
  if (type === "sublet" && listing.category === "Sublet") return null;
  return (
    <Badge
      className={cn(
        "border-transparent font-medium text-white",
        type === "room" ? "bg-teal-600" : "bg-violet-600",
        "theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[2px_2px_0_#000]",
        className,
      )}
    >
      {type === "room" ? "Room" : "Sublet"}
    </Badge>
  );
}

/** Confirmed in-unit washer/dryer; absence means unknown, so no "no W/D" badge. */
function LaundryBadge({
  listing,
  className,
}: {
  listing: Listing;
  className?: string;
}) {
  if (listing.laundry !== "in_unit") return null;
  return (
    <Badge
      className={cn(
        "border-transparent bg-sky-600 font-medium text-white",
        "theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[2px_2px_0_#000]",
        className,
      )}
    >
      <WashingMachine className="size-3" />
      W/D
    </Badge>
  );
}

function EmailedBadge({ className }: { className?: string }) {
  return (
    <Badge
      className={cn(
        "border-transparent bg-emerald-600 font-medium text-white",
        "theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[2px_2px_0_#000]",
        className,
      )}
    >
      <MailCheck className="size-3" />
      Emailed
    </Badge>
  );
}

/**
 * Toggles the browser-local "I already emailed this one" mark. Rendered
 * inside link/click areas, so it swallows the event.
 */
function ContactedButton({
  contactedAt,
  onToggle,
  className,
}: {
  contactedAt: string | null;
  onToggle: () => void;
  className?: string;
}) {
  const marked = contactedAt != null;
  const label = marked
    ? `Emailed ${formatPosted(contactedAt)} — click to unmark`
    : "Mark as emailed";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={marked}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-colors",
        marked
          ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
          : "border-border bg-background/90 text-muted-foreground backdrop-blur hover:text-foreground",
        "theme8bit:rounded-none theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[2px_2px_0_#000] theme8bit:backdrop-blur-none",
        className,
      )}
    >
      {marked ? <MailCheck className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
    </button>
  );
}

function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <Badge
      className={cn(
        "border-transparent bg-amber-500 font-medium text-white",
        "theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[2px_2px_0_#000]",
        className,
      )}
    >
      Coming soon
    </Badge>
  );
}

function listingMeta(listing: Listing): string[] {
  return [
    listing.beds != null ? `${listing.beds} bed` : null,
    listing.bath != null ? `${listing.bath} bath` : null,
    listing.size_sqft != null ? `${listing.size_sqft} sqft` : null,
    listing.address,
  ].filter((v): v is string => Boolean(v));
}

function formatPrice(price: number | null): string {
  return price != null ? `$${price.toLocaleString()}` : "N/A";
}

function ListingPhoto({
  listing,
  sizes,
  className,
}: {
  listing: Listing;
  sizes: string;
  className?: string;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoFailed ? undefined : listing.pictures?.[0];

  if (!photo) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No photo
      </div>
    );
  }
  return (
    <Image
      src={photo}
      alt={listing.title ?? "Listing photo"}
      fill
      sizes={sizes}
      className={className}
      // StreetEasy's photo CDN blocks the Next.js image optimizer
      // (PerimeterX bot protection), so the browser must load those
      // images directly.
      unoptimized={listing.source === "streeteasy"}
      onError={() => setPhotoFailed(true)}
    />
  );
}

function ListingCard({
  listing,
  contactedAt,
  onToggleContacted,
}: {
  listing: Listing;
  contactedAt: string | null;
  onToggleContacted: () => void;
}) {
  const posted = formatListingDate(listing);
  const meta = listingMeta(listing);

  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block"
    >
      <Card
        className={cn(
          "h-full gap-0 py-0 transition-shadow hover:shadow-md theme8bit:hover:translate-x-px theme8bit:hover:translate-y-px",
          contactedAt != null && "opacity-70",
        )}
      >
        <div className="relative aspect-4/3 w-full bg-muted">
          <ListingPhoto
            listing={listing}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {listing.category && (
              <Badge className="border-transparent bg-black/70 text-white backdrop-blur theme8bit:border-2 theme8bit:border-black theme8bit:bg-black theme8bit:backdrop-blur-none">
                {listing.category}
              </Badge>
            )}
            <ListingTypeBadge listing={listing} />
            <LaundryBadge listing={listing} />
            {contactedAt != null && <EmailedBadge />}
          </div>
          <SourceBadge
            source={listing.source}
            className="absolute right-3 top-3 theme8bit:backdrop-blur-none"
          />
          {isComingSoon(listing.write_dt) && (
            <ComingSoonBadge className="absolute bottom-3 left-3" />
          )}
          <ContactedButton
            contactedAt={contactedAt}
            onToggle={onToggleContacted}
            className="absolute bottom-3 right-3"
          />
        </div>
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-bold theme8bit:[font-family:var(--font-pixel)] theme8bit:text-base">
              {formatPrice(listing.price)}
              {listing.price != null && (
                <span className="text-sm font-normal text-muted-foreground">
                  /mo
                </span>
              )}
            </span>
            {posted && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {posted}
              </span>
            )}
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-foreground/80">
            {listing.title ?? listing.address ?? "Untitled listing"}
          </p>
          {meta.length > 0 && (
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              {meta.slice(0, 3).map((m, i) => (
                <span key={i} className="truncate">
                  {m}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </a>
  );
}

function ListingRow({
  listing,
  contactedAt,
  onToggleContacted,
}: {
  listing: Listing;
  contactedAt: string | null;
  onToggleContacted: () => void;
}) {
  const posted = formatListingDate(listing);
  const meta = listingMeta(listing);
  const open = () => window.open(listing.url, "_blank", "noopener,noreferrer");

  return (
    <TableRow
      className={cn("cursor-pointer", contactedAt != null && "opacity-60")}
      onClick={open}
    >
      <TableCell>
        <div className="relative h-14 w-20 overflow-hidden rounded-md bg-muted sm:h-16 sm:w-24">
          <ListingPhoto
            listing={listing}
            sizes="96px"
            className="object-cover"
          />
        </div>
      </TableCell>
      <TableCell className="max-w-[380px] whitespace-normal">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="line-clamp-2 font-medium hover:underline sm:line-clamp-1"
        >
          {listing.title ?? listing.address ?? "Untitled listing"}
        </a>
        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {meta.join(" · ") || "No details"}
        </div>
        {/* Mobile only: the hidden columns collapse into this stacked block. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
          <span className="font-semibold theme8bit:[font-family:var(--font-pixel)]">
            {formatPrice(listing.price)}
            {listing.price != null && (
              <span className="text-xs font-normal text-muted-foreground">
                /mo
              </span>
            )}
          </span>
          <SourceBadge source={listing.source} />
          {listing.category && (
            <Badge variant="outline">{listing.category}</Badge>
          )}
          <ListingTypeBadge listing={listing} />
          <LaundryBadge listing={listing} />
          {contactedAt != null && <EmailedBadge />}
          {isComingSoon(listing.write_dt) && <ComingSoonBadge />}
          {posted && (
            <span className="text-xs text-muted-foreground">{posted}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <SourceBadge source={listing.source} />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <div className="flex flex-wrap gap-1">
          {listing.category ? (
            <Badge variant="outline">{listing.category}</Badge>
          ) : listing.listing_type == null ||
            listing.listing_type === "apartment" ? (
            <span className="text-muted-foreground">—</span>
          ) : null}
          <ListingTypeBadge listing={listing} />
          <LaundryBadge listing={listing} />
        </div>
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        <div className="flex items-center gap-2">
          <span>{posted ?? "—"}</span>
          {isComingSoon(listing.write_dt) && <ComingSoonBadge />}
        </div>
      </TableCell>
      <TableCell className="hidden font-semibold theme8bit:[font-family:var(--font-pixel)] theme8bit:text-xs sm:table-cell">
        {formatPrice(listing.price)}
        {listing.price != null && (
          <span className="text-xs font-normal text-muted-foreground">/mo</span>
        )}
      </TableCell>
      <TableCell>
        <ContactedButton
          contactedAt={contactedAt}
          onToggle={onToggleContacted}
        />
      </TableCell>
    </TableRow>
  );
}
