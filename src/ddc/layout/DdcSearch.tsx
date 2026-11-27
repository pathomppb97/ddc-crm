import { useEffect, useState } from "react";
import { useTranslate } from "ra-core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getResourceDef } from "../resources/registry";
import { useLabel } from "../ui/labels";
import { useDdcDataProvider } from "../features/useDdcDataProvider";

/** Search across products, leads, RFQs, quotations, projects and complaints. */
export const DdcSearch = () => {
  const translate = useTranslate();
  const label = useLabel();
  const dataProvider = useDdcDataProvider();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const { data = [], isFetching } = useQuery({
    queryKey: ["ddc", "search", query],
    queryFn: () => dataProvider.ddcSearch(query, 6),
    enabled: query.length >= 2,
    meta: { persist: false },
  });

  return (
    <div className="relative w-full min-w-0 max-w-md">
      <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={translate("ddc.search.placeholder")}
        aria-label={translate("ddc.search.placeholder")}
        className="pl-8"
      />
      {open && query.length >= 2 ? (
        <div
          role="listbox"
          className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow"
        >
          {data.length === 0 ? (
            <p className="p-2 text-muted-foreground">
              {isFetching
                ? translate("ra.page.loading")
                : translate("ddc.search.no_results")}
            </p>
          ) : (
            data.map((result) => {
              const def = getResourceDef(result.resource);
              return (
                <Link
                  key={`${result.resource}-${result.record_id}`}
                  role="option"
                  to={`/${result.resource}/${result.record_id}/show`}
                  className="block rounded px-2 py-1 hover:bg-muted"
                  onClick={() => setOpen(false)}
                >
                  <span className="text-xs text-muted-foreground">
                    {def ? label(def.label.one) : result.resource}
                  </span>{" "}
                  <span className="font-medium">{result.title}</span>
                  {result.subtitle ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {result.subtitle}
                    </span>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
};
