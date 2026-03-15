enum TabOption {
  PLANNER = "planner",
  BROWSER = "browser",
  VSCODE = "vscode",
  PHOTO = "photo",
  VIDEO = "video",
}

type TabType =
  | TabOption.PLANNER
  | TabOption.BROWSER
  | TabOption.VSCODE
  | TabOption.PHOTO
  | TabOption.VIDEO;
const AllTabs = [
  TabOption.VSCODE,
  TabOption.BROWSER,
  TabOption.PLANNER,
  TabOption.PHOTO,
  TabOption.VIDEO,
];

export { AllTabs, TabOption, type TabType };
