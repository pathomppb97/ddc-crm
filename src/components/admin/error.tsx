import {
  useEffect,
  useMemo,
  type HtmlHTMLAttributes,
  type ErrorInfo,
} from "react";
import type { FallbackProps } from "react-error-boundary";
import { useResetErrorBoundaryOnLocationChange, Translate } from "ra-core";
import { CircleAlert, History, RefreshCw } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { logCrmError } from "@/ddc/errors/crmError";
import { useDdcLocale } from "@/ddc/ui/labels";

/**
 * App-wide error component for displaying error boundaries.
 *
 * Logs technical diagnostics with a correlation ID, displays a clear localized
 * message to users, and exposes stack details only in non-production builds.
 */
export const Error = (props: InternalErrorProps & {}) => {
  const { error, errorInfo, resetErrorBoundary, ...rest } = props;
  const locale = useDdcLocale();

  useResetErrorBoundaryOnLocationChange(resetErrorBoundary);

  const normalized = useMemo(
    () => logCrmError(error, { operation: "render" }),
    [error],
  );

  useEffect(() => {
    logCrmError(error, { operation: "render" });
  }, [error]);

  const userMessage =
    locale === "en" ? normalized.userMessageEn : normalized.userMessageTh;

  return (
    <div
      className="flex flex-col items-center px-4 py-8 text-center md:p-16 gap-4"
      {...rest}
    >
      <h1
        className="flex flex-wrap items-center justify-center text-xl sm:text-3xl mt-2 gap-3"
        role="alert"
      >
        <CircleAlert className="size-7 shrink-0 text-destructive" />
        <Translate i18nKey="ddc.error.page_title" />
      </h1>
      <p className="max-w-lg text-sm text-foreground">{userMessage}</p>
      <p className="max-w-lg text-xs text-muted-foreground">
        <Translate i18nKey="ddc.error.page_hint" />
      </p>
      <p className="rounded bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
        <Translate i18nKey="ddc.error.ref_label" />: {normalized.requestId}
      </p>
      {process.env.NODE_ENV !== "production" && (
        <Accordion
          multiple
          className="mt-1 p-2 bg-secondary w-full lg:w-150 text-left"
        >
          <AccordionItem value="error">
            <AccordionTrigger className="py-2 break-all">
              {normalized.technicalMessage}
            </AccordionTrigger>
            <AccordionContent className="whitespace-pre-wrap pt-1 overflow-x-auto">
              <pre className="text-xs">{errorInfo?.componentStack}</pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button onClick={goBack} variant="outline" className="min-h-11">
          <History />
          <Translate i18nKey="ra.action.back" />
        </Button>
        <Button onClick={resetErrorBoundary} className="min-h-11">
          <RefreshCw />
          <Translate i18nKey="ddc.common.retry" />
        </Button>
      </div>
    </div>
  );
};

interface InternalErrorProps
  extends Omit<HtmlHTMLAttributes<HTMLDivElement>, "title">, FallbackProps {
  className?: string;
  errorInfo?: ErrorInfo;
}

export interface ErrorProps extends Pick<FallbackProps, "error"> {
  errorInfo?: ErrorInfo;
}

function goBack() {
  window.history.go(-1);
}
