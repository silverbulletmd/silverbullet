/**
 * We apply a selective export of allowed icons.
 * It allows us to only import icons which fit an editor context, this avoids inflating the
 * bundle size with mostly unused icons, but still allows users to freely choose from the allowed
 * selection.
 */
export {
  MdChecklist,
  MdCode,
  MdFileUpload,
  MdFormatBold,
  MdFormatIndentDecrease,
  MdFormatIndentIncrease,
  MdFormatItalic,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdFormatQuote,
  MdFormatSize,
  MdFormatStrikethrough,
  MdHome,
  MdHorizontalRule,
  MdImage,
  MdLink,
  MdOutlineLibraryBooks,
  MdTerminal,
} from "react-icons/md";
