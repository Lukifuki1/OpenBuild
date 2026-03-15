import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import OpenBuildLogo from "#/assets/branding/openbuild-logo.png";
import { I18nKey } from "#/i18n/declaration";
import { StyledTooltip } from "#/components/shared/buttons/styled-tooltip";

export function OpenHandsLogoButton() {
  const { t } = useTranslation();

  const tooltipText = t(I18nKey.BRANDING$OPENBUILD);
  const ariaLabel = t(I18nKey.BRANDING$OPENBUILD_LOGO);

  return (
    <StyledTooltip content={tooltipText}>
      <NavLink to="/" aria-label={ariaLabel}>
        <img
          src={OpenBuildLogo}
          alt="OpenBuild"
          width={46}
          height={30}
          className="object-contain"
        />
      </NavLink>
    </StyledTooltip>
  );
}
