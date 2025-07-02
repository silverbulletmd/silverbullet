import type { ComponentChildren } from "preact";
import { useRef, useState, useEffect } from "preact/hooks";
import type { Command } from "../../type/command.ts";

export interface TooltipProps {
  text: string;
  shortcut?: string;
  macShortcut?: string;
  commandName?: string;
  commands?: Map<string, Command>;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  delay?: number;
  disabled?: boolean;
  className?: string;
  children: ComponentChildren;
}

export function Tooltip({
  text,
  shortcut,
  macShortcut,
  commandName,
  commands,
  position = 'auto',
  delay = 500,
  disabled = false,
  className = '',
  children,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(position);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number>();

  let dynamicShortcut = shortcut;
  let dynamicMacShortcut = macShortcut;

  if (commandName && commands && !shortcut && !macShortcut) {
    const command = commands.get(commandName);
    if (command) {
      dynamicShortcut = command.key;
      dynamicMacShortcut = command.mac;
    }
  }

  const formattedShortcut = formatShortcut(dynamicShortcut, dynamicMacShortcut);

  const showTooltip = () => {
    if (disabled || (!text && !formattedShortcut)) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = globalThis.setTimeout(() => {
      setIsVisible(true);
      updatePosition();
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = globalThis.innerWidth;
    const viewportHeight = globalThis.innerHeight;

    let finalPosition = position;

    if (position === 'auto') {
      // 'Smart' positioning based on available space
      const spaceTop = triggerRect.top;
      const spaceBottom = viewportHeight - triggerRect.bottom;
      const spaceLeft = triggerRect.left;
      const spaceRight = viewportWidth - triggerRect.right;

      if (spaceTop > tooltipRect.height + 10) {
        finalPosition = 'top';
      } else if (spaceBottom > tooltipRect.height + 10) {
        finalPosition = 'bottom';
      } else if (spaceRight > tooltipRect.width + 10) {
        finalPosition = 'right';
      } else if (spaceLeft > tooltipRect.width + 10) {
        finalPosition = 'left';
      } else {
        finalPosition = 'bottom';
      }
    }

    setTooltipPosition(finalPosition);
  };

  const handleFocus = () => {
    showTooltip();
  };

  const handleBlur = () => {
    hideTooltip();
  };

  // Touch support for mobile
  const handleTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (isVisible) {
      hideTooltip();
    } else {
      showTooltip();
    }
  };

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    // Add event listeners for touch devices
    const isTouchDevice = 'ontouchstart' in globalThis;
    if (isTouchDevice) {
      trigger.addEventListener('touchstart', handleTouchStart);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (isTouchDevice && trigger) {
        trigger.removeEventListener('touchstart', handleTouchStart);
      }
    };
  }, []);

  // Close tooltip when clicking outside on touch devices
  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node)
      ) {
        hideTooltip();
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isVisible]);

  if (disabled || (!text && !formattedShortcut)) {
    return <>{children}</>;
  }

  return (
    <div className="sb-tooltip-wrapper">
      <div
        ref={triggerRef}
        className="sb-tooltip-trigger"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {children}
      </div>
      {isVisible && (
        <div
          ref={tooltipRef}
          className={`sb-tooltip ${tooltipPosition} ${className} visible`}
          role="tooltip"
          aria-hidden={!isVisible}
        >
          <div className="tooltip-content">
            {text && <span className="tooltip-text">{text}</span>}
            {formattedShortcut && (
              <span className="tooltip-shortcut">{formattedShortcut}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatShortcut(key?: string, mac?: string): string | undefined {
  if (!key && !mac) return undefined;

  const isMac = isMacLike();
  const shortcut = isMac && mac ? mac : key;

  if (!shortcut) return undefined;

  let formatted = shortcut;

  if (isMac) {
    // Mac-specific symbol replacements
    formatted = formatted
      .replace(/Cmd/g, '⌘')
      .replace(/Ctrl/g, '⌃')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/Option/g, '⌥');
  } else {
    // Windows/Linux formatting – could use Mac symbols as well…
    formatted = formatted
      .replace(/Cmd/g, 'Ctrl')
      .replace(/Ctrl/g, 'Ctrl')
      .replace(/Alt/g, 'Alt')
      .replace(/Shift/g, 'Shift');
  }

  // Common special key replacements
  formatted = formatted
    .replace(/Enter/g, '⏎')
    .replace(/Space/g, '␣')
    .replace(/ArrowUp/g, '↑')
    .replace(/ArrowDown/g, '↓')
    .replace(/ArrowLeft/g, '←')
    .replace(/ArrowRight/g, '→')
    .replace(/Escape/g, 'Esc')
    .replace(/Backspace/g, '⌫')
    .replace(/Delete/g, '⌦')
    .replace(/Tab/g, '⇥');

  // Replace +/- with spaces for cleaner display
  formatted = formatted.replace(/\+/g, ' ').replace(/\-/g, ' ');

  return formatted;
}

function isMacLike(): boolean {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}