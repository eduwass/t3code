-- Give T3 Space its Mac Command shortcuts without Omac or workspace shortcuts
-- consuming them. The app's portable "mod" bindings mean Ctrl on Linux.
local function workspace_step(delta)
  return function()
    local workspace = hl.get_active_workspace()
    if not workspace or workspace.id < 1 then return end
    local target = math.max(1, math.min(5, workspace.id + delta))
    if target ~= workspace.id then
      hl.dispatch(hl.dsp.focus({ workspace = tostring(target) }))
    end
  end
end

hl.define_submap("t3space", function()
  for _, key in ipairs({ "B", "T", "C" }) do
    o.bind("SUPER + CTRL + ALT + SHIFT + " .. key, "New app window (hyper)", o.new_app_window[key])
  end
  local keys = { "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "LEFT", "RIGHT", "UP", "DOWN", "TAB", "RETURN", "SPACE", "BACKSPACE",
    "EQUAL", "PLUS", "MINUS", "UNDERSCORE", "BRACKETLEFT", "BRACKETRIGHT",
    "BRACELEFT", "BRACERIGHT", "COMMA", "PERIOD", "SLASH", "QUESTION", "F6" }
  for code = string.byte("A"), string.byte("Z") do table.insert(keys, string.char(code)) end
  local window_keys = { LEFT = true, RIGHT = true, UP = true, DOWN = true, F = true }
  for _, modifiers in ipairs({
    { "SUPER", "CTRL" }, { "SUPER SHIFT", "CTRL SHIFT" },
    { "SUPER ALT", "CTRL ALT" }, { "SUPER ALT SHIFT", "CTRL ALT SHIFT" },
  }) do
    for _, key in ipairs(keys) do
      if not (modifiers[1] == "SUPER ALT" and window_keys[key])
        and not (modifiers[1] == "SUPER" and (key == "SPACE" or key == "Q")) then
      hl.bind(modifiers[1]:gsub(" ", " + ") .. " + " .. key, function()
        hl.dispatch(hl.dsp.send_key_state({ mods = modifiers[2], key = key, state = "down" }))
        hl.timer(function()
          hl.dispatch(hl.dsp.send_key_state({ mods = modifiers[2], key = key, state = "up" }))
        end, { timeout = 50, type = "oneshot" })
      end, { description = "T3 Space Command shortcut" })
      end
    end
  end
  o.bind("SUPER + Q", "Close window", hl.dsp.window.close())
  o.bind("SUPER + SPACE", "Omacast launcher", hl.dsp.global("omacast:toggle"))
  o.bind("ALT + SPACE", "Omacast launcher", hl.dsp.global("omacast:toggle"))
  for _, direction in ipairs({ { "LEFT", "l" }, { "RIGHT", "r" }, { "UP", "u" }, { "DOWN", "d" } }) do
    o.bind("SUPER + ALT + " .. direction[1], "Focus neighboring window", hl.dsp.focus({ direction = direction[2] }))
    o.bind("SUPER + CTRL + " .. direction[1], "Move window", hl.dsp.window.swap({ direction = direction[2] }))
  end
  o.bind("SUPER + ALT + F", "Fullscreen", hl.dsp.window.fullscreen({ mode = "fullscreen" }))
  o.bind("SUPER + CTRL + ALT + SHIFT + S", "Toggle status bar", "omarchy-toggle-bar")
  o.bind("SUPER + CTRL + ALT + SHIFT + F", "Toggle floating", hl.dsp.window.float({ action = "toggle" }))
  for n = 1, 9 do
    o.bind("SUPER + CTRL + ALT + SHIFT + " .. n, "Workspace " .. n, hl.dsp.focus({ workspace = tostring(n) }))
  end
  o.bind("SUPER + CTRL + ALT + SHIFT + LEFT", "Previous workspace", workspace_step(-1))
  o.bind("SUPER + CTRL + ALT + SHIFT + RIGHT", "Next workspace", workspace_step(1))
  hl.bind("CTRL + SHIFT + Escape", hl.dsp.submap("reset"))
end)

local function focus(window)
  if window and window.class == "com.t3tools.T3Code" then
    hl.dispatch(hl.dsp.submap("t3space"))
  elseif hl.get_current_submap() == "t3space" then
    hl.dispatch(hl.dsp.submap("reset"))
  end
end
hl.on("window.active", focus)
focus(hl.get_active_window())
