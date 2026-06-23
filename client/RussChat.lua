--[[
    ╔══════════════════════════════════════════════╗
    ║                 RUSS  CHAT                     ║
    ║      Клиент для Ultra-Secure Chat Server       ║
    ║   Запускать через executor (инжектор) Roblox   ║
    ╚══════════════════════════════════════════════╝

    Что делает:
      • логинится на сервере и получает JWT-токен
      • опрашивает /chat и показывает сообщения
      • отправляет сообщения через /chat
      • обрабатывает протухший токен (401) и rate-limit (429)

    Перед запуском поменяй SERVER_URL на адрес своего сервера на Render.
]]--

-- ============ КОНФИГ ============
local CONFIG = {
    -- Адрес твоего сервера на Render (без слэша в конце):
    SERVER_URL  = "https://secure-chat-server.onrender.com",
    -- Имя в чате. nil = взять ник Roblox-игрока автоматически.
    USERNAME    = nil,
    -- Если входишь под админ-аккаунтом — впиши ADMIN_SECRET, иначе оставь "".
    ADMIN_SECRET = "",
    -- Как часто опрашивать сервер (сек). Не меньше 1.5, иначе rate-limit.
    POLL_INTERVAL = 2,
}

-- ============ СЕРВИСЫ ============
local Players     = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local UserInput   = game:GetService("UserInputService")

local LocalPlayer = Players.LocalPlayer
local USERNAME = CONFIG.USERNAME or (LocalPlayer and LocalPlayer.Name) or "Guest"

-- ============ HTTP (поддержка разных executor'ов) ============
local httpRequest = (syn and syn.request)
    or (http and http.request)
    or http_request
    or (fluxus and fluxus.request)
    or request

if not httpRequest then
    warn("[RussChat] Твой executor не поддерживает HTTP-запросы (request).")
    return
end

local function apiRequest(method, path, body, token)
    local headers = {
        ["User-Agent"] = "RussChatClient/1.0",
        ["Accept"]     = "application/json",
    }
    if token then headers["X-Auth-Token"] = token end
    if body  then headers["Content-Type"] = "application/json" end

    local ok, res = pcall(function()
        return httpRequest({
            Url     = CONFIG.SERVER_URL .. path,
            Method  = method,
            Headers = headers,
            Body    = body and HttpService:JSONEncode(body) or nil,
        })
    end)

    if not ok or not res then
        return nil, 0
    end

    local status = res.StatusCode or res.Status or 0
    local data = nil
    if res.Body and #res.Body > 0 then
        local decoded
        local okJson = pcall(function() decoded = HttpService:JSONDecode(res.Body) end)
        if okJson then data = decoded end
    end
    return data, status
end

-- ============ СОСТОЯНИЕ ============
local token        = nil
local connected    = false
local running      = true
local canSend      = true
local seenIds      = {}      -- id сообщений, которые уже показаны
local roleInfo     = nil

-- ============ API ============
local function login()
    local data, status = apiRequest("POST", "/auth/login", {
        player = USERNAME,
        adminSecret = (CONFIG.ADMIN_SECRET ~= "" and CONFIG.ADMIN_SECRET) or nil,
    })
    if status == 200 and data and data.token then
        token = data.token
        roleInfo = data.role
        connected = true
        return true
    end
    connected = false
    if status == 403 then
        return false, (data and data.error) or "Доступ запрещён (бан/секрет)"
    end
    return false, "Не удалось подключиться (" .. tostring(status) .. ")"
end

-- forward declares (GUI определяется ниже)
local addSystemMessage, addChatMessage, setStatus

local function fetchMessages()
    local data, status = apiRequest("GET", "/chat", nil, token)
    if status == 401 then
        -- токен протух — перелогиниваемся
        if login() then return fetchMessages() end
        return
    end
    if status == 200 and type(data) == "table" then
        for _, m in ipairs(data) do
            if m.id and not seenIds[m.id] then
                seenIds[m.id] = true
                addChatMessage(m)
            end
        end
    end
end

local function sendMessage(text)
    if not canSend then
        addSystemMessage("⏳ Подожди пару секунд (rate-limit)")
        return
    end
    canSend = false
    task.delay(3, function() canSend = true end)

    local data, status = apiRequest("POST", "/chat", { message = text }, token)
    if status == 401 then
        if login() then sendMessage(text) end
        return
    elseif status == 429 then
        addSystemMessage("⏳ Слишком часто. Подожди немного.")
    elseif status == 403 then
        addSystemMessage("🚫 " .. ((data and data.error) or "Запрещено (бан/мут)"))
    elseif status == 400 then
        addSystemMessage("⚠️ " .. ((data and data.error) or "Сообщение отклонено"))
    elseif status ~= 200 then
        addSystemMessage("❌ Ошибка отправки (" .. tostring(status) .. ")")
    end
end

-- ============ GUI ============
local COLORS = {
    bg       = Color3.fromRGB(22, 22, 30),
    bgLight  = Color3.fromRGB(32, 32, 44),
    input    = Color3.fromRGB(40, 40, 54),
    accent   = Color3.fromRGB(120, 90, 255),
    accent2  = Color3.fromRGB(80, 140, 255),
    text     = Color3.fromRGB(235, 235, 245),
    sub      = Color3.fromRGB(150, 150, 170),
    online   = Color3.fromRGB(80, 220, 120),
    offline  = Color3.fromRGB(230, 90, 90),
    system   = Color3.fromRGB(170, 170, 190),
}

local function corner(parent, r)
    local c = Instance.new("UICorner")
    c.CornerRadius = UDim.new(0, r or 8)
    c.Parent = parent
    return c
end

local function padding(parent, p)
    local pad = Instance.new("UIPadding")
    pad.PaddingTop = UDim.new(0, p)
    pad.PaddingBottom = UDim.new(0, p)
    pad.PaddingLeft = UDim.new(0, p)
    pad.PaddingRight = UDim.new(0, p)
    pad.Parent = parent
    return pad
end

-- Контейнер для GUI (защищённый, если executor умеет gethui)
local guiParent = (gethui and gethui())
    or (game:FindService("CoreGui"))
    or LocalPlayer:WaitForChild("PlayerGui")

-- удалить старую копию, если переоткрыли
local old = guiParent:FindFirstChild("RussChatGui")
if old then old:Destroy() end

local screen = Instance.new("ScreenGui")
screen.Name = "RussChatGui"
screen.ResetOnSpawn = false
screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screen.Parent = guiParent

-- Главное окно
local main = Instance.new("Frame")
main.Name = "Main"
main.Size = UDim2.new(0, 430, 0, 340)
main.Position = UDim2.new(0.5, -215, 0.5, -170)
main.BackgroundColor3 = COLORS.bg
main.BorderSizePixel = 0
main.Parent = screen
corner(main, 12)

local stroke = Instance.new("UIStroke")
stroke.Color = COLORS.accent
stroke.Thickness = 1.5
stroke.Transparency = 0.4
stroke.Parent = main

-- Заголовок
local titleBar = Instance.new("Frame")
titleBar.Name = "TitleBar"
titleBar.Size = UDim2.new(1, 0, 0, 40)
titleBar.BackgroundColor3 = COLORS.bgLight
titleBar.BorderSizePixel = 0
titleBar.Parent = main
corner(titleBar, 12)

local titleGrad = Instance.new("UIGradient")
titleGrad.Color = ColorSequence.new(COLORS.accent, COLORS.accent2)
titleGrad.Rotation = 25
titleGrad.Parent = titleBar

local titleText = Instance.new("TextLabel")
titleText.BackgroundTransparency = 1
titleText.Position = UDim2.new(0, 14, 0, 0)
titleText.Size = UDim2.new(1, -120, 1, 0)
titleText.Font = Enum.Font.GothamBold
titleText.Text = "💬  RUSS CHAT"
titleText.TextSize = 16
titleText.TextColor3 = Color3.new(1, 1, 1)
titleText.TextXAlignment = Enum.TextXAlignment.Left
titleText.Parent = titleBar

-- Индикатор статуса
local statusDot = Instance.new("Frame")
statusDot.Size = UDim2.new(0, 10, 0, 10)
statusDot.Position = UDim2.new(1, -96, 0.5, -5)
statusDot.BackgroundColor3 = COLORS.offline
statusDot.BorderSizePixel = 0
statusDot.Parent = titleBar
corner(statusDot, 5)

-- Кнопка свернуть
local minBtn = Instance.new("TextButton")
minBtn.Size = UDim2.new(0, 30, 0, 30)
minBtn.Position = UDim2.new(1, -74, 0.5, -15)
minBtn.BackgroundColor3 = Color3.fromRGB(255, 200, 60)
minBtn.Text = "–"
minBtn.Font = Enum.Font.GothamBold
minBtn.TextSize = 18
minBtn.TextColor3 = Color3.new(0, 0, 0)
minBtn.AutoButtonColor = true
minBtn.Parent = titleBar
corner(minBtn, 8)

-- Кнопка закрыть
local closeBtn = Instance.new("TextButton")
closeBtn.Size = UDim2.new(0, 30, 0, 30)
closeBtn.Position = UDim2.new(1, -38, 0.5, -15)
closeBtn.BackgroundColor3 = COLORS.offline
closeBtn.Text = "✕"
closeBtn.Font = Enum.Font.GothamBold
closeBtn.TextSize = 14
closeBtn.TextColor3 = Color3.new(1, 1, 1)
closeBtn.AutoButtonColor = true
closeBtn.Parent = titleBar
corner(closeBtn, 8)

-- Область сообщений
local scroll = Instance.new("ScrollingFrame")
scroll.Name = "Messages"
scroll.Position = UDim2.new(0, 8, 0, 48)
scroll.Size = UDim2.new(1, -16, 1, -104)
scroll.BackgroundColor3 = COLORS.bgLight
scroll.BorderSizePixel = 0
scroll.ScrollBarThickness = 4
scroll.ScrollBarImageColor3 = COLORS.accent
scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
scroll.Parent = main
corner(scroll, 10)
padding(scroll, 8)

local listLayout = Instance.new("UIListLayout")
listLayout.Padding = UDim.new(0, 6)
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.Parent = scroll

-- Нижняя панель (ввод + отправка)
local inputBar = Instance.new("Frame")
inputBar.Position = UDim2.new(0, 8, 1, -48)
inputBar.Size = UDim2.new(1, -16, 0, 40)
inputBar.BackgroundTransparency = 1
inputBar.Parent = main

local box = Instance.new("TextBox")
box.Size = UDim2.new(1, -92, 1, 0)
box.BackgroundColor3 = COLORS.input
box.BorderSizePixel = 0
box.Font = Enum.Font.Gotham
box.PlaceholderText = "Введите сообщение..."
box.PlaceholderColor3 = COLORS.sub
box.Text = ""
box.TextColor3 = COLORS.text
box.TextSize = 14
box.TextXAlignment = Enum.TextXAlignment.Left
box.ClearTextOnFocus = false
box.TextTruncate = Enum.TextTruncate.AtEnd
box.Parent = inputBar
corner(box, 8)
padding(box, 10)

local sendBtn = Instance.new("TextButton")
sendBtn.Size = UDim2.new(0, 82, 1, 0)
sendBtn.Position = UDim2.new(1, -82, 0, 0)
sendBtn.BackgroundColor3 = COLORS.accent
sendBtn.Text = "Отправить"
sendBtn.Font = Enum.Font.GothamBold
sendBtn.TextSize = 14
sendBtn.TextColor3 = Color3.new(1, 1, 1)
sendBtn.AutoButtonColor = true
sendBtn.Parent = inputBar
corner(sendBtn, 8)

-- ============ РЕНДЕР СООБЩЕНИЙ ============
local function escapeRich(s)
    s = s:gsub("&", "&amp;")
    s = s:gsub("<", "&lt;")
    s = s:gsub(">", "&gt;")
    return s
end

local function roleColorHex(role)
    if not role then return "ffffff" end
    local c = role.color
    if c == "GOLD" then return "ffd700" end
    if c == "RAINBOW" then return "ff7ad9" end
    return "9b7aff"
end

local function scrollToBottom()
    task.defer(function()
        scroll.CanvasPosition = Vector2.new(0, scroll.AbsoluteCanvasSize.Y)
    end)
end

local msgOrder = 0
local function makeLabel()
    msgOrder += 1
    local lbl = Instance.new("TextLabel")
    lbl.BackgroundTransparency = 1
    lbl.Size = UDim2.new(1, -8, 0, 0)
    lbl.AutomaticSize = Enum.AutomaticSize.Y
    lbl.Font = Enum.Font.Gotham
    lbl.TextSize = 14
    lbl.TextColor3 = COLORS.text
    lbl.TextXAlignment = Enum.TextXAlignment.Left
    lbl.TextWrapped = true
    lbl.RichText = true
    lbl.LayoutOrder = msgOrder
    lbl.Parent = scroll
    return lbl
end

addChatMessage = function(m)
    local lbl = makeLabel()
    local name = escapeRich(tostring(m.player or "?"))
    local body = escapeRich(tostring(m.msg or ""))
    local badge = (m.role and m.role.badge) and (m.role.badge .. " ") or ""
    local hex = roleColorHex(m.role)
    if m.type == "announcement" then
        lbl.Text = string.format('<font color="#ffcc44"><b>%s</b></font>', body)
    else
        lbl.Text = string.format('<font color="#%s"><b>%s%s</b></font>: %s', hex, badge, name, body)
    end
    scrollToBottom()
end

addSystemMessage = function(text)
    local lbl = makeLabel()
    lbl.TextColor3 = COLORS.system
    lbl.Font = Enum.Font.GothamMedium
    lbl.RichText = false
    lbl.Text = text
    scrollToBottom()
end

setStatus = function(isOnline, label)
    local goal = { BackgroundColor3 = isOnline and COLORS.online or COLORS.offline }
    TweenService:Create(statusDot, TweenInfo.new(0.25), goal):Play()
    if label then titleText.Text = "💬  RUSS CHAT  —  " .. label end
end

-- ============ ЛОГИКА КНОПОК ============
local function doSend()
    local text = box.Text
    if not text or #text:gsub("%s", "") == 0 then return end
    box.Text = ""
    sendMessage(text)
end

sendBtn.MouseButton1Click:Connect(doSend)
box.FocusLost:Connect(function(enterPressed)
    if enterPressed then doSend() end
end)

-- Закрыть
closeBtn.MouseButton1Click:Connect(function()
    running = false
    TweenService:Create(main, TweenInfo.new(0.2), { Size = UDim2.new(0, 0, 0, 0) }):Play()
    task.wait(0.2)
    screen:Destroy()
end)

-- Свернуть / развернуть
local minimized = false
minBtn.MouseButton1Click:Connect(function()
    minimized = not minimized
    local h = minimized and 40 or 340
    TweenService:Create(main, TweenInfo.new(0.2), { Size = UDim2.new(0, 430, 0, h) }):Play()
    scroll.Visible = not minimized
    inputBar.Visible = not minimized
end)

-- Перетаскивание за заголовок
do
    local dragging, dragStart, startPos
    titleBar.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1
            or input.UserInputType == Enum.UserInputType.Touch then
            dragging = true
            dragStart = input.Position
            startPos = main.Position
            input.Changed:Connect(function()
                if input.UserInputState == Enum.UserInputState.End then
                    dragging = false
                end
            end)
        end
    end)
    UserInput.InputChanged:Connect(function(input)
        if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement
            or input.UserInputType == Enum.UserInputType.Touch) then
            local delta = input.Position - dragStart
            main.Position = UDim2.new(
                startPos.X.Scale, startPos.X.Offset + delta.X,
                startPos.Y.Scale, startPos.Y.Offset + delta.Y
            )
        end
    end)
end

-- Анимация открытия
main.Size = UDim2.new(0, 0, 0, 0)
TweenService:Create(main, TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
    { Size = UDim2.new(0, 430, 0, 340) }):Play()

-- ============ ЗАПУСК ============
addSystemMessage("Подключение к серверу как «" .. USERNAME .. "»...")

task.spawn(function()
    local ok, err = login()
    if not ok then
        setStatus(false, "офлайн")
        addSystemMessage("❌ " .. tostring(err))
        return
    end
    local who = roleInfo and roleInfo.prefix and (" [" .. roleInfo.prefix .. "]") or ""
    setStatus(true, "онлайн")
    addSystemMessage("✅ Подключено" .. who .. ". Приятного общения!")

    -- цикл опроса сервера
    while running do
        if connected then
            local okPoll = pcall(fetchMessages)
            if not okPoll then setStatus(false, "ошибка сети") end
        end
        task.wait(math.max(1.5, CONFIG.POLL_INTERVAL))
    end
end)
