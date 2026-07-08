"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { LayoutGrid, List, Scroll } from "lucide-react";
import type { Listing } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
};

const SOURCE_KEYS = Object.keys(SOURCE_BRAND) as Listing["source"][];

const PRICE_CAP = 2000;
const PAGE_SIZE_OPTIONS = [8, 24, 60, 100] as const;
const DISPLAY_COUNT_LABELS: Record<string, string> = {
  "8": "8",
  "24": "24",
  "60": "60",
  "100": "100",
};

export default function ListingsGrid({ listings }: { listings: Listing[] }) {
  const [source, setSource] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [capPrice, setCapPrice] = useState(false);
  const [view, setView] = useState<ViewMode>("cards");
  const [pageSize, setPageSize] = useState<number>(24);
  const [page, setPage] = useState(1);

  // Listings without a price are kept; they can't be proven to be above the cap.
  const byPrice = useMemo(
    () =>
      capPrice
        ? listings.filter((l) => l.price == null || l.price <= PRICE_CAP)
        : listings,
    [listings, capPrice],
  );

  const bySource = useMemo(
    () =>
      source === "all" ? byPrice : byPrice.filter((l) => l.source === source),
    [byPrice, source],
  );

  const categories = useMemo(() => {
    const names = new Map<string, number>();
    for (const l of bySource) {
      const name = l.category ?? "Other";
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    return [...names.entries()].sort((a, b) => b[1] - a[1]);
  }, [bySource]);

  const visible = useMemo(() => {
    let result = bySource;
    if (category !== "all") {
      result = result.filter((l) => (l.category ?? "Other") === category);
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
  }, [bySource, category, sort]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of byPrice) counts[l.source] = (counts[l.source] ?? 0) + 1;
    return counts;
  }, [byPrice]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = visible.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl theme8bit:uppercase theme8bit:tracking-widest theme8bit:text-[#f4d35e] theme8bit:text-lg sm:theme8bit:text-xl theme8bit:[font-family:var(--font-pixel)]">
          <Scroll className="h-7 w-7 shrink-0 text-muted-foreground sm:h-8 sm:w-8" />
          The NYC Master List
        </h1>
        <p className="mt-1 text-sm text-muted-foreground theme8bit:[font-family:var(--font-pixel)] theme8bit:leading-relaxed">
          {listings.length} listings{" "}
          <span className="line-through">scraped</span> from HeyKorean, Zillow,
          StreetEasy, Craigslist, and Facebook Marketplace
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={`All sources (${byPrice.length})`}
          active={source === "all"}
          onClick={() => {
            setSource("all");
            setCategory("all");
            setPage(1);
          }}
        />
        {SOURCE_KEYS.map((key) => (
          <SourceFilterChip
            key={key}
            source={key}
            count={sourceCounts[key] ?? 0}
            active={source === key}
            onClick={() => {
              setSource(key);
              setCategory("all");
              setPage(1);
            }}
          />
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground">
          <Switch
            className="rounded-none **:data-[slot=switch-thumb]:rounded-none"
            checked={capPrice}
            onCheckedChange={(checked) => {
              setCapPrice(checked);
              setPage(1);
            }}
          />
          Under $2,000
        </label>
        <Select
          value={sort}
          items={SORT_LABELS}
          onValueChange={(value) => {
            setSort(value as SortKey);
            setPage(1);
          }}
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

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <FilterChip
          label={`All types (${bySource.length})`}
          active={category === "all"}
          onClick={() => {
            setCategory("all");
            setPage(1);
          }}
        />
        {categories.map(([name, count]) => (
          <FilterChip
            key={name}
            label={`${name} (${count})`}
            active={category === name}
            onClick={() => {
              setCategory(name);
              setPage(1);
            }}
          />
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            Display
          </span>
          <Select
            value={String(pageSize)}
            items={DISPLAY_COUNT_LABELS}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
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

      <ListingsPagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={visible.length}
        onPageChange={goToPage}
        className="mb-6"
      />

      {view === "cards" ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 theme8bit:gap-4 theme8bit:border-4 theme8bit:border-black theme8bit:p-2 theme8bit:shadow-[6px_6px_0_#000]">
          {pageItems.map((listing) => (
            <ListingCard
              key={`${listing.source}:${listing.ext_id}`}
              listing={listing}
            />
          ))}
        </div>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[112px]"></TableHead>
                <TableHead>Listing</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((listing) => (
                <ListingRow
                  key={`${listing.source}:${listing.ext_id}`}
                  listing={listing}
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

  // Windowed page numbers: 1 ... c-1 c c+1 ... last
  const pages: (number | "ellipsis")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }

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

function ListingCard({ listing }: { listing: Listing }) {
  const posted = formatPosted(listing.write_dt);
  const meta = listingMeta(listing);

  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block"
    >
      <Card className="h-full gap-0 py-0 transition-shadow hover:shadow-md theme8bit:hover:translate-x-px theme8bit:hover:translate-y-px">
        <div className="relative aspect-4/3 w-full bg-muted">
          <ListingPhoto
            listing={listing}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {listing.category && (
            <Badge className="absolute left-3 top-3 border-transparent bg-black/70 text-white backdrop-blur theme8bit:border-2 theme8bit:border-black theme8bit:bg-black theme8bit:backdrop-blur-none">
              {listing.category}
            </Badge>
          )}
          <SourceBadge
            source={listing.source}
            className="absolute right-3 top-3 theme8bit:backdrop-blur-none"
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

function ListingRow({ listing }: { listing: Listing }) {
  const posted = formatPosted(listing.write_dt);
  const meta = listingMeta(listing);
  const open = () => window.open(listing.url, "_blank", "noopener,noreferrer");

  return (
    <TableRow className="cursor-pointer" onClick={open}>
      <TableCell>
        <div className="relative h-16 w-24 overflow-hidden rounded-md bg-muted">
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
          className="line-clamp-1 font-medium hover:underline"
        >
          {listing.title ?? listing.address ?? "Untitled listing"}
        </a>
        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {meta.join(" · ") || "No details"}
        </div>
      </TableCell>
      <TableCell>
        <SourceBadge source={listing.source} />
      </TableCell>
      <TableCell>
        {listing.category ? (
          <Badge variant="outline">{listing.category}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{posted ?? "—"}</TableCell>
      <TableCell className="text-right font-semibold theme8bit:[font-family:var(--font-pixel)]">
        {formatPrice(listing.price)}
        {listing.price != null && (
          <span className="text-xs font-normal text-muted-foreground">/mo</span>
        )}
      </TableCell>
    </TableRow>
  );
}
