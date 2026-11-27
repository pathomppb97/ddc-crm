import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import provinces from "../../data/geoThai/provinces.json";
import districts from "../../data/geoThai/districts.json";
import type { DdcLocale } from "../../ui/labels";

interface LocationOption {
  code: string;
  name_th: string;
  name_en: string;
}

const bangkokCode = "10";
const bangkokAliases = ["กรุงเทพ", "กรุงเทพฯ", "กทม."];
const searchKey = (text: string) =>
  text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^(?:จังหวัด|จ\.|อำเภอ|อ\.|เขต)\s*/, "")
    .replace(/[.\s]+/g, "");

function locationTerms(option: LocationOption) {
  return [
    option.name_th,
    option.name_en,
    ...(option.code === bangkokCode ? bangkokAliases : []),
  ];
}

function findLocation(options: LocationOption[], value: string) {
  const key = searchKey(value);
  return key
    ? options.find((option) =>
        locationTerms(option).some((name) => searchKey(name) === key),
      )
    : undefined;
}

function LocationPicker({
  label,
  selected,
  value,
  options,
  locale,
  disabled = false,
  onChange,
}: {
  label: string;
  selected?: LocationOption;
  value: string;
  options: LocationOption[];
  locale: DdcLocale;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const labelFor = (option: LocationOption) =>
    locale === "th" ? option.name_th : option.name_en;
  const placeholder = disabled
    ? locale === "th"
      ? "เลือกจังหวัดก่อน"
      : "Select a province first"
    : locale === "th"
      ? `เลือก${label}`
      : `Select ${label.toLowerCase()}`;
  const searchLabel =
    locale === "th" ? `ค้นหา${label}…` : `Search ${label.toLowerCase()}…`;
  const display = selected ? labelFor(selected) : value || placeholder;
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="min-w-0">
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="text-xs text-muted-foreground"
      >
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
            />
          }
          aria-labelledby={`${id}-label ${id}-value`}
          className="mt-1 h-11 w-full min-w-0 justify-between border-input px-2.5 font-normal text-sm"
        >
          <span
            id={`${id}-value`}
            className={value ? "truncate" : "truncate text-muted-foreground"}
          >
            {display}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          initialFocus={searchRef}
          aria-labelledby={`${id}-label`}
          className="w-(--anchor-width) max-w-(--available-width) gap-0 p-0"
        >
          <Command
            label={label}
            className="[&_[data-slot=input-group]]:h-11!"
            filter={(_code, query, keywords) =>
              keywords?.some((term) =>
                searchKey(term).includes(searchKey(query)),
              )
                ? 1
                : 0
            }
          >
            <CommandInput
              ref={searchRef}
              aria-label={searchLabel}
              placeholder={searchLabel}
            />
            <CommandList className="max-h-[min(16rem,max(4rem,calc(var(--available-height)_-_7rem)))] p-1">
              <CommandEmpty>
                {locale === "th" ? "ไม่พบรายการ" : "No results"}
              </CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.code}
                  value={option.code}
                  keywords={locationTerms(option)}
                  onSelect={() => choose(option.name_th)}
                  className="min-h-11"
                >
                  <span>{labelFor(option)}</span>
                  {selected?.code === option.code && (
                    <Check aria-hidden="true" className="ml-auto size-4" />
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
          {value && (
            <Button
              type="button"
              variant="ghost"
              className="m-1 h-11 justify-start"
              onClick={() => choose("")}
            >
              {locale === "th"
                ? `ล้าง${label}`
                : `Clear ${label.toLowerCase()}`}
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function CustomerLocationFields({
  province,
  district,
  locale,
  onChange,
}: {
  province: string;
  district: string;
  locale: DdcLocale;
  onChange: (province: string, district: string) => void;
}) {
  const provinceOption = findLocation(provinces, province);
  const availableDistricts = provinceOption
    ? districts.filter((option) => option.province_code === provinceOption.code)
    : [];
  const districtLabel =
    provinceOption?.code === bangkokCode
      ? locale === "th"
        ? "เขต"
        : "District"
      : locale === "th"
        ? "อำเภอ"
        : "District";

  return (
    <>
      <LocationPicker
        label={locale === "th" ? "จังหวัด" : "Province"}
        selected={provinceOption}
        value={province}
        options={provinces}
        locale={locale}
        onChange={(next) =>
          onChange(
            next,
            next && next === provinceOption?.name_th ? district : "",
          )
        }
      />
      <LocationPicker
        label={districtLabel}
        selected={findLocation(availableDistricts, district)}
        value={district}
        options={availableDistricts}
        locale={locale}
        disabled={!provinceOption}
        onChange={(next) => onChange(province, next)}
      />
    </>
  );
}
