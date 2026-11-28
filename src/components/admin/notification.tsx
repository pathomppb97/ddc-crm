import * as React from "react";
import { useCallback, useEffect } from "react";
import type { ToasterProps } from "sonner";
import { Toaster, toast } from "sonner";
import { useTheme } from "@/components/admin/use-theme";
import {
  CloseNotificationContext,
  useLocaleState,
  useNotificationContext,
  useTakeUndoableMutation,
  useTranslate,
} from "ra-core";
import {
  formatUserErrorMessage,
  isTechnicalNotificationMessage,
  logCrmError,
  shouldSuppressDuplicateToast,
} from "@/ddc/errors/crmError";

/**
 * Displays notifications triggered with the useNotify hook.
 *
 * Supports different notification types (info, success, warning, error) and undoable mutations.
 * Automatically adapts to the current theme (light/dark).
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/notification Notification documentation}
 * @see {@link https://marmelab.com/ra-core/usenotify/ useNotify hook}
 *
 * @example
 * // Trigger a notification
 * import { useNotify } from 'ra-core';
 *
 * const NotifyButton = () => {
 *   const notify = useNotify();
 *   const handleClick = () => {
 *     notify('Comment approved', { type: 'success' });
 *   };
 *   return <button onClick={handleClick}>Notify</button>;
 * };
 */
export const Notification = (props: ToasterProps) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const { notifications, takeNotification } = useNotificationContext();
  const takeMutation = useTakeUndoableMutation();
  const { theme } = useTheme();
  const appLocale: "th" | "en" = locale === "en" ? "en" : "th";

  useEffect(() => {
    if (notifications.length) {
      const notification = takeNotification();
      if (notification) {
        const { message, type = "info", notificationOptions } = notification;
        const { messageArgs, undoable, autoHideDuration } =
          notificationOptions || {};

        const beforeunload = (e: BeforeUnloadEvent) => {
          e.preventDefault();
          const confirmationMessage = "";
          e.returnValue = confirmationMessage;
          return confirmationMessage;
        };

        if (undoable) {
          window.addEventListener("beforeunload", beforeunload);
        }

        const mutation = takeMutation();

        const handleExited = () => {
          if (undoable) {
            if (mutation) {
              mutation({ isUndo: false });
            }
            window.removeEventListener("beforeunload", beforeunload);
          }
        };

        const handleUndo = () => {
          if (mutation) {
            mutation({ isUndo: true });
          }
          window.removeEventListener("beforeunload", beforeunload);
        };

        const rawStringMessage =
          typeof message === "string" ? message : undefined;

        let finalMessage = message
          ? typeof message === "string"
            ? translate(message, messageArgs)
            : React.isValidElement(message)
              ? message
              : undefined
          : undefined;

        let toastId: string | undefined;
        if (type === "error" || type === "warning") {
          const textForCheck =
            typeof finalMessage === "string"
              ? rawStringMessage && rawStringMessage !== finalMessage
                ? `${rawStringMessage} ${finalMessage}`
                : finalMessage
              : (rawStringMessage ?? "");
          if (
            type === "error" &&
            isTechnicalNotificationMessage(textForCheck)
          ) {
            const normalized = logCrmError(textForCheck, {
              operation: "notification",
            });
            finalMessage = formatUserErrorMessage(normalized, appLocale);
            toastId = `crm-err:${normalized.dedupeKey}`;
          } else {
            const sig =
              typeof finalMessage === "string"
                ? finalMessage
                : (rawStringMessage ?? type);
            toastId = `crm-${type}:${sig}`;
          }
          if (shouldSuppressDuplicateToast(toastId)) {
            return;
          }
        }

        const duration =
          autoHideDuration === null ? Infinity : autoHideDuration;

        toast[type](finalMessage, {
          ...(toastId ? { id: toastId } : {}),
          duration,
          action: undoable
            ? {
                label: translate("ra.action.undo"),
                onClick: handleUndo,
              }
            : undefined,
          onDismiss: handleExited,
          onAutoClose: handleExited,
        });
      }
    }
  }, [appLocale, notifications, takeMutation, takeNotification, translate]);

  const handleRequestClose = useCallback(() => {
    // Dismiss all toasts
    toast.dismiss();
  }, []);

  return (
    <CloseNotificationContext.Provider value={handleRequestClose}>
      <Toaster
        richColors
        theme={theme}
        closeButton
        position="bottom-center"
        {...props}
      />
    </CloseNotificationContext.Provider>
  );
};
