--[[
    ╔══════════════════════════════════════════════╗
    ║                 RUSS  CHAT  v2                 ║
    ║      Клиент для Ultra-Secure Chat Server       ║
    ║   Запускать через executor (инжектор) Roblox   ║
    ╚══════════════════════════════════════════════╝

    GUI появляется ВСЕГДА (даже без сервера/без HTTP).
    Поменяй SERVER_URL на адрес своего сервера на Render.
    Если что-то не работает — на экране и в консоли будет текст ошибки.
]]--

-- ============ КОНФИГ ============
local CONFIG = {
    SERVER_URL    = "https://secure-chat-server.onrender.com", -- свой адрес Render
    USERNAME      = nil,   -- nil = взять ник Roblox автоматически
    ADMIN_SECRET  = "",    -- заполни, если входишь админом
    POLL_INTERVAL = 2,     -- опрос сервера, сек (не меньше 1.5)
}

-- ============ СЕРВИСЫ ============
local Players      = game:GetService("Players")
local HttpService  = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local UserInput    = game:GetService("UserInputService")
local StarterGui   = game:GetService("StarterGui")

local LocalPlayer = Players.LocalPlayer
local USERNAME = CONFIG.USERNAME or (LocalPlayer and LocalPlayer.Name) or "Guest"

-- Показать уведомление (для фатальных ошибок) — всегда в pcall
local function notify(title, text)
    pcall(function()
        StarterGui:SetCore("SendNotification", { Title = title, Text = text, Duration = 8 })
    end)
    warn("[RussChat] " .. tostring(title) .. ": " .. tostring(text))
end

-- ============ ВСЁ ОСТАЛЬНОЕ В ЗАЩИЩЁННОМ БЛОКЕ ============
local ok, buildErr = pcall(function()

    -- ---- HTTP (опционально) ----
    local httpRequest = (syn and syn.request)
        or (http and http.request)
        or http_request
        or (fluxus and fluxus.request)
        or (getgenv and getgenv().request)
        or request
    local hasHttp = httpRequest ~= nil

    -- ---- ЦВЕТА ----
    local COLORS = {
        bg      = Color3.fromRGB(22, 22, 30),
        bgLight = Color3.fromRGB(32, 32, 44),
        input   = Color3.fromRGB(40, 40, 54),
        accent  = Color3.fromRGB(120, 90, 255),
        accent2 = Color3.fromRGB(80, 140, 255),
        text    = Color3.fromRGB(235, 235, 245),
        sub     = Color3.fromRGB(150, 150, 170),
        online  = Color3.fromRGB(80, 220, 120),
        offline = Color3.fromRGB(230, 90, 90),
        system  = Color3.fromRGB(170, 170, 190),
    }

    local function corner(parent, r)
        local c = Instance.new("UICorner"); c.CornerRadius = UDim.new(0, r or 8); c.Parent = parent; return c
    end
    local function pad(parent, p)
        local u = Instance.new("UIPadding")
        u.PaddingTop = UDim.new(0, p); u.PaddingBottom = UDim.new(0, p)
        u.PaddingLeft = UDim.new(0, p); u.PaddingRight = UDim.new(0, p)
        u.Parent = parent; return u
    end

    -- ---- КУДА ПАРЕНТИТЬ GUI ----
    local guiParent
    pcall(function() if gethui then guiParent = gethui() end end)
    if not guiParent then pcall(function() guiParent = game:GetService("CoreGui") end) end
    if not guiParent and LocalPlayer then
        pcall(function() guiParent = LocalPlayer:WaitForChild("PlayerGui", 5) end)
    end
    if not guiParent then error("не найден контейнер для GUI (CoreGui/PlayerGui)") end

    local old = guiParent:FindFirstChild("RussChatGui")
    if old then old:Destroy() end

    -- ---- SCREENGUI ----
    local screen = Instance.new("ScreenGui")
    screen.Name = "RussChatGui"
    screen.ResetOnSpawn = false
    screen.IgnoreGuiInset = true
    screen.DisplayOrder = 9999
    screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
    screen.Parent = guiParent
    pcall(function() if syn and syn.protect_gui then syn.protect_gui(screen) end end)

    -- ---- ГЛАВНОЕ ОКНО (сразу полноразмерное и видимое) ----
    local main = Instance.new("Frame")
    main.Name = "Main"
    main.Size = UDim2.new(0, 440, 0, 350)
    main.Position = UDim2.new(0.5, -220, 0.5, -175)
    main.BackgroundColor3 = COLORS.bg
    main.BorderSizePixel = 0
    main.Active = true
    main.Parent = screen
    corner(main, 12)

    local uiScale = Instance.new("UIScale"); uiScale.Scale = 1; uiScale.Parent = main

    local stroke = Instance.new("UIStroke")
    stroke.Color = COLORS.accent; stroke.Thickness = 1.5; stroke.Transparency = 0.4
    stroke.Parent = main

    -- ---- ЗАГОЛОВОК ----
    local titleBar = Instance.new("Frame")
    titleBar.Size = UDim2.new(1, 0, 0, 40)
    titleBar.BackgroundColor3 = COLORS.bgLight
    titleBar.BorderSizePixel = 0
    titleBar.Active = true
    titleBar.Parent = main
    corner(titleBar, 12)

    local grad = Instance.new("UIGradient")
    grad.Color = ColorSequence.new(COLORS.accent, COLORS.accent2)
    grad.Rotation = 25; grad.Parent = titleBar

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

    local statusDot = Instance.new("Frame")
    statusDot.Size = UDim2.new(0, 10, 0, 10)
    statusDot.Position = UDim2.new(1, -96, 0.5, -5)
    statusDot.BackgroundColor3 = COLORS.offline
    statusDot.BorderSizePixel = 0
    statusDot.Parent = titleBar
    corner(statusDot, 5)

    local minBtn = Instance.new("TextButton")
    minBtn.Size = UDim2.new(0, 30, 0, 30); minBtn.Position = UDim2.new(1, -74, 0.5, -15)
    minBtn.BackgroundColor3 = Color3.fromRGB(255, 200, 60)
    minBtn.Text = "–"; minBtn.Font = Enum.Font.GothamBold; minBtn.TextSize = 18
    minBtn.TextColor3 = Color3.new(0, 0, 0); minBtn.Parent = titleBar
    corner(minBtn, 8)

    local closeBtn = Instance.new("TextButton")
    closeBtn.Size = UDim2.new(0, 30, 0, 30); closeBtn.Position = UDim2.new(1, -38, 0.5, -15)
    closeBtn.BackgroundColor3 = COLORS.offline
    closeBtn.Text = "✕"; closeBtn.Font = Enum.Font.GothamBold; closeBtn.TextSize = 14
    closeBtn.TextColor3 = Color3.new(1, 1, 1); closeBtn.Parent = titleBar
    corner(closeBtn, 8)

    -- ---- ОБЛАСТЬ СООБЩЕНИЙ ----
    local scroll = Instance.new("ScrollingFrame")
    scroll.Position = UDim2.new(0, 8, 0, 48)
    scroll.Size = UDim2.new(1, -16, 1, -104)
    scroll.BackgroundColor3 = COLORS.bgLight
    scroll.BorderSizePixel = 0
    scroll.ScrollBarThickness = 4
    scroll.ScrollBarImageColor3 = COLORS.accent
    scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
    scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
    scroll.Parent = main
    corner(scroll, 10); pad(scroll, 8)

    local layout = Instance.new("UIListLayout")
    layout.Padding = UDim.new(0, 6)
    layout.SortOrder = Enum.SortOrder.LayoutOrder
    layout.Parent = scroll

    -- ---- ПАНЕЛЬ ВВОДА ----
    local inputBar = Instance.new("Frame")
    inputBar.Position = UDim2.new(0, 8, 1, -48)
    inputBar.Size = UDim2.new(1, -16, 0, 40)
    inputBar.BackgroundTransparency = 1
    inputBar.Parent = main

    local box = Instance.new("TextBox")
    box.Size = UDim2.new(1, -92, 1, 0)
    box.BackgroundColor3 = COLORS.input; box.BorderSizePixel = 0
    box.Font = Enum.Font.Gotham
    box.PlaceholderText = "Введите сообщение..."
    box.PlaceholderColor3 = COLORS.sub
    box.Text = ""; box.TextColor3 = COLORS.text; box.TextSize = 14
    box.TextXAlignment = Enum.TextXAlignment.Left
    box.ClearTextOnFocus = false
    box.Parent = inputBar
    corner(box, 8); pad(box, 10)

    local sendBtn = Instance.new("TextButton")
    sendBtn.Size = UDim2.new(0, 82, 1, 0); sendBtn.Position = UDim2.new(1, -82, 0, 0)
    sendBtn.BackgroundColor3 = COLORS.accent
    sendBtn.Text = "Отправить"; sendBtn.Font = Enum.Font.GothamBold; sendBtn.TextSize = 14
    sendBtn.TextColor3 = Color3.new(1, 1, 1); sendBtn.Parent = inputBar
    corner(sendBtn, 8)

    -- ============ РЕНДЕР СООБЩЕНИЙ ============
    local function esc(s)
        s = tostring(s):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
        return s
    end
    local function roleHex(role)
        if not role then return "ffffff" end
        if role.color == "GOLD" then return "ffd700" end
        if role.color == "RAINBOW" then return "ff7ad9" end
        return "9b7aff"
    end
    local function scrollDown()
        task.defer(function()
            scroll.CanvasPosition = Vector2.new(0, scroll.AbsoluteCanvasSize.Y)
        end)
    end
    local order = 0
    local function newLabel()
        order += 1
        local l = Instance.new("TextLabel")
        l.BackgroundTransparency = 1
        l.Size = UDim2.new(1, -8, 0, 0)
        l.AutomaticSize = Enum.AutomaticSize.Y
        l.Font = Enum.Font.Gotham; l.TextSize = 14
        l.TextColor3 = COLORS.text
        l.TextXAlignment = Enum.TextXAlignment.Left
        l.TextWrapped = true; l.RichText = true
        l.LayoutOrder = order; l.Parent = scroll
        return l
    end
    local function addChat(m)
        local l = newLabel()
        local body = esc(m.msg or "")
        if m.type == "announcement" then
            l.Text = string.format('<font color="#ffcc44"><b>%s</b></font>', body)
        else
            local badge = (m.role and m.role.badge) and (m.role.badge .. " ") or ""
            l.Text = string.format('<font color="#%s"><b>%s%s</b></font>: %s',
                roleHex(m.role), badge, esc(m.player or "?"), body)
        end
        scrollDown()
    end
    local function addSys(t)
        local l = newLabel()
        l.TextColor3 = COLORS.system; l.Font = Enum.Font.GothamMedium; l.RichText = false
        l.Text = t; scrollDown()
    end
    local function setStatus(isOn, label)
        TweenService:Create(statusDot, TweenInfo.new(0.25),
            { BackgroundColor3 = isOn and COLORS.online or COLORS.offline }):Play()
        if label then titleText.Text = "💬  RUSS CHAT  —  " .. label end
    end

    -- ============ СОСТОЯНИЕ + API ============
    local token, connected, running, canSend = nil, false, true, true
    local roleInfo = nil
    local seenIds = {}

    local function apiRequest(method, path, body)
        if not hasHttp then return nil, -1 end
        local headers = { ["User-Agent"] = "RussChatClient/1.0", ["Accept"] = "application/json" }
        if token then headers["X-Auth-Token"] = token end
        if body then headers["Content-Type"] = "application/json" end
        local okReq, res = pcall(function()
            return httpRequest({
                Url = CONFIG.SERVER_URL .. path, Method = method,
                Headers = headers, Body = body and HttpService:JSONEncode(body) or nil,
            })
        end)
        if not okReq or not res then return nil, 0 end
        local status = res.StatusCode or res.Status or 0
        local data
        if res.Body and #res.Body > 0 then
            pcall(function() data = HttpService:JSONDecode(res.Body) end)
        end
        return data, status
    end

    local function login()
        local data, status = apiRequest("POST", "/auth/login", {
            player = USERNAME,
            adminSecret = (CONFIG.ADMIN_SECRET ~= "" and CONFIG.ADMIN_SECRET) or nil,
        })
        if status == 200 and data and data.token then
            token, roleInfo, connected = data.token, data.role, true
            return true
        end
        connected = false
        if status == -1 then return false, "executor без HTTP — чат офлайн" end
        if status == 403 then return false, (data and data.error) or "доступ запрещён" end
        if status == 0 then return false, "сервер недоступен (проверь SERVER_URL)" end
        return false, "ошибка входа (" .. tostring(status) .. ")"
    end

    local function fetchMessages()
        local data, status = apiRequest("GET", "/chat")
        if status == 401 then if login() then return fetchMessages() end return end
        if status == 200 and type(data) == "table" then
            for _, m in ipairs(data) do
                if m.id and not seenIds[m.id] then seenIds[m.id] = true; addChat(m) end
            end
        end
    end

    local function sendMessage(text)
        -- офлайн / без сервера — просто показываем локально (GUI работает)
        if not connected then
            addChat({ player = USERNAME .. " (локально)", msg = text, role = roleInfo })
            return
        end
        if not canSend then addSys("⏳ Подожди пару секунд (rate-limit)"); return end
        canSend = false; task.delay(3, function() canSend = true end)
        local data, status = apiRequest("POST", "/chat", { message = text })
        if status == 401 then if login() then sendMessage(text) end
        elseif status == 429 then addSys("⏳ Слишком часто, подожди.")
        elseif status == 403 then addSys("🚫 " .. ((data and data.error) or "бан/мут"))
        elseif status == 400 then addSys("⚠️ " .. ((data and data.error) or "отклонено"))
        elseif status ~= 200 then addSys("❌ ошибка отправки (" .. tostring(status) .. ")") end
    end

    -- ============ КНОПКИ ============
    local function doSend()
        local t = box.Text
        if not t or #t:gsub("%s", "") == 0 then return end
        box.Text = ""
        task.spawn(sendMessage, t)
    end
    sendBtn.MouseButton1Click:Connect(doSend)
    box.FocusLost:Connect(function(enter) if enter then doSend() end end)

    closeBtn.MouseButton1Click:Connect(function()
        running = false
        TweenService:Create(uiScale, TweenInfo.new(0.2), { Scale = 0 }):Play()
        task.wait(0.2); screen:Destroy()
    end)

    local minimized = false
    minBtn.MouseButton1Click:Connect(function()
        minimized = not minimized
        TweenService:Create(main, TweenInfo.new(0.2),
            { Size = UDim2.new(0, 440, 0, minimized and 40 or 350) }):Play()
        scroll.Visible = not minimized; inputBar.Visible = not minimized
    end)

    -- перетаскивание
    do
        local dragging, dragStart, startPos
        titleBar.InputBegan:Connect(function(i)
            if i.UserInputType == Enum.UserInputType.MouseButton1
                or i.UserInputType == Enum.UserInputType.Touch then
                dragging = true; dragStart = i.Position; startPos = main.Position
                i.Changed:Connect(function()
                    if i.UserInputState == Enum.UserInputState.End then dragging = false end
                end)
            end
        end)
        UserInput.InputChanged:Connect(function(i)
            if dragging and (i.UserInputType == Enum.UserInputType.MouseMovement
                or i.UserInputType == Enum.UserInputType.Touch) then
                local d = i.Position - dragStart
                main.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X,
                    startPos.Y.Scale, startPos.Y.Offset + d.Y)
            end
        end)
    end

    -- лёгкая анимация открытия (косметика; если не сыграет — окно всё равно видно)
    uiScale.Scale = 0.85
    TweenService:Create(uiScale, TweenInfo.new(0.25, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
        { Scale = 1 }):Play()

    -- ============ ЗАПУСК ============
    addSys("Окно загружено. Имя: " .. USERNAME)
    if not hasHttp then
        addSys("⚠️ Твой executor не даёт HTTP — работает только офлайн-демо.")
        setStatus(false, "офлайн")
    else
        addSys("Подключаюсь к серверу...")
        task.spawn(function()
            local okLogin, err = login()
            if not okLogin then
                setStatus(false, "офлайн")
                addSys("❌ " .. tostring(err))
                addSys("(можешь писать — сообщения видно локально)")
                return
            end
            setStatus(true, "онлайн")
            addSys("✅ Подключено" ..
                (roleInfo and roleInfo.prefix and (" [" .. roleInfo.prefix .. "]") or "") .. "!")
            while running do
                pcall(fetchMessages)
                task.wait(math.max(1.5, CONFIG.POLL_INTERVAL))
            end
        end)
    end
end) -- конец защищённого блока

if not ok then
    notify("RussChat: ошибка", tostring(buildErr))
end
