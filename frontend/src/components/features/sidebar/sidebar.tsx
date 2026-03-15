import React from "react";
import { useLocation, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useGitUser } from "#/hooks/query/use-git-user";
import { UserActions } from "./user-actions";
import { OpenHandsLogoButton } from "#/components/shared/buttons/openhands-logo-button";
import { NewProjectButton } from "#/components/shared/buttons/new-project-button";
import { ConversationPanelButton } from "#/components/shared/buttons/conversation-panel-button";
import { SettingsModal } from "#/components/shared/modals/settings/settings-modal";
import { useSettings } from "#/hooks/query/use-settings";
import { ConversationPanel } from "../conversation-panel/conversation-panel";
import { ConversationPanelWrapper } from "../conversation-panel/conversation-panel-wrapper";
import { useLogout } from "#/hooks/mutation/use-logout";
import { useConfig } from "#/hooks/query/use-config";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import ImageIcon from "#/icons/image.svg?react";

export function Sidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const user = useGitUser();
  const { data: config } = useConfig();
  const {
    data: settings,
    error: settingsError,
    isError: settingsIsError,
    isFetching: isFetchingSettings,
  } = useSettings();
  const { mutate: logout } = useLogout();

  const [settingsModalIsOpen, setSettingsModalIsOpen] = React.useState(false);

  const [conversationPanelIsOpen, setConversationPanelIsOpen] =
    React.useState(false);

  React.useEffect(() => {
    if (pathname === "/settings") {
      setSettingsModalIsOpen(false);
    } else if (
      !isFetchingSettings &&
      settingsIsError &&
      settingsError?.status !== 404
    ) {
      // We don't show toast errors for settings in the global error handler
      // because we have a special case for 404 errors
      displayErrorToast(
        "Something went wrong while fetching settings. Please reload the page.",
      );
    } else if (
      config?.app_mode === "oss" &&
      settingsError?.status === 404 &&
      !config?.feature_flags?.hide_llm_settings
    ) {
      setSettingsModalIsOpen(true);
    }
  }, [
    pathname,
    isFetchingSettings,
    settingsIsError,
    settingsError,
    config?.app_mode,
    config?.feature_flags?.hide_llm_settings,
  ]);

  return (
    <>
      <aside
        aria-label={t(I18nKey.SIDEBAR$NAVIGATION_LABEL)}
        className={cn(
          "h-[54px] p-3 md:p-0 md:h-[40px] md:h-auto flex flex-row md:flex-col gap-1 bg-base md:w-[75px] md:min-w-[75px] sm:pt-0 sm:px-2 md:pt-[14px] md:px-0",
          pathname === "/" && "md:pt-6.5 md:pb-3",
        )}
      >
        <nav className="flex flex-row md:flex-col items-center justify-between w-full h-auto md:w-auto md:h-full">
          <div className="flex flex-row md:flex-col items-center gap-[26px]">
            <div className="flex items-center justify-center">
              <OpenHandsLogoButton />
            </div>
            <div>
              <NewProjectButton disabled={settings?.email_verified === false} />
            </div>
            <ConversationPanelButton
              isOpen={conversationPanelIsOpen}
              onClick={() =>
                settings?.email_verified === false
                  ? null
                  : setConversationPanelIsOpen((prev) => !prev)
              }
              disabled={settings?.email_verified === false}
            />
            <Link
              to="/photo"
              className={cn(
                "p-0 bg-transparent border-0",
                pathname === "/photo" ? "text-white" : "text-[#B1B9D3]",
              )}
              aria-label={t(I18nKey.PHOTO_TAB$TITLE)}
            >
              <ImageIcon width={24} height={24} />
            </Link>
            <Link
              to="/video"
              className={cn(
                "p-0 bg-transparent border-0",
                pathname === "/video" ? "text-white" : "text-[#B1B9D3]",
              )}
              aria-label={t(I18nKey.VIDEO_TAB$TITLE)}
            >
              <ImageIcon width={24} height={24} />
            </Link>
          </div>

          <div className="flex flex-row md:flex-col md:items-center gap-[26px]">
            <UserActions
              user={
                user.data ? { avatar_url: user.data.avatar_url } : undefined
              }
              onLogout={logout}
              isLoading={user.isFetching}
            />
          </div>
        </nav>

        {conversationPanelIsOpen && (
          <ConversationPanelWrapper isOpen={conversationPanelIsOpen}>
            <ConversationPanel
              onClose={() => setConversationPanelIsOpen(false)}
            />
          </ConversationPanelWrapper>
        )}
      </aside>

      {settingsModalIsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsModalIsOpen(false)}
        />
      )}
    </>
  );
}
