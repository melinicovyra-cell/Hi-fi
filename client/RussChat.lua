--[[
    RUSS CHAT  v3  —  клиент для Ultra-Secure Chat Server
    Запускать через executor (инжектор) Roblox.

    • Аватарки игроков (rbxthumb), тень окна (rbxassetid)
    • Discord-стиль: аватар + цветной ник + текст
    • Нарисованные иконки (без эмодзи), ховер-анимации
    • GUI появляется ВСЕГДА; ошибки показываются уведомлением

    Поменяй CONFIG.SERVER_URL на адрес своего сервера на Render.
]]--

-- ============ КОНФИГ ============
local CONFIG = {
    SERVER_URL    = "https://secure-chat-server.onrender.com",
    USERNAME      = nil,   -- nil = ник Roblox автоматически
    ADMIN_SECRET  = "",
    POLL_INTERVAL = 2,
}

-- ============ СЕРВИСЫ ============
local Players      = game:GetService("Players")
local HttpService  = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local UserInput    = game:GetService("UserInputService")
local StarterGui   = game:GetService("StarterGui")

local LocalPlayer = Players.LocalPlayer
local USERNAME = CONFIG.USERNAME or (LocalPlayer and LocalPlayer.Name) or "Guest"

local function notify(title, text)
    pcall(function()
        StarterGui:SetCore("SendNotification", { Title = title, Text = text, Duration = 8 })
    end)
    warn("[RussChat] " .. tostring(title) .. ": " .. tostring(text))
end

-- ============ ЗАЩИЩЁННЫЙ БЛОК ============
local ok, buildErr = pcall(function()

    local httpRequest = (syn and syn.request) or (http and http.request)
        or http_request or (fluxus and fluxus.request)
        or (getgenv and getgenv().request) or request
    local hasHttp = httpRequest ~= nil

    -- ---------- ПАЛИТРА ----------
    local C = {
        bg       = Color3.fromRGB(21, 21, 28),
        bgGrad   = Color3.fromRGB(16, 16, 22),
        surface  = Color3.fromRGB(31, 31, 43),
        surface2 = Color3.fromRGB(42, 42, 56),
        stroke   = Color3.fromRGB(48, 48, 64),
        accent   = Color3.fromRGB(108, 92, 231),
        accentHi = Color3.fromRGB(126, 110, 244),
        textPri  = Color3.fromRGB(236, 236, 241),
        textMut  = Color3.fromRGB(138, 138, 156),
        online   = Color3.fromRGB(63, 185, 80),
        offline  = Color3.fromRGB(229, 83, 75),
        warn     = Color3.fromRGB(232, 196, 92),
    }

    local function round(inst, r) local u=Instance.new("UICorner"); u.CornerRadius=UDim.new(0,r); u.Parent=inst; return u end
    local function circle(inst) local u=Instance.new("UICorner"); u.CornerRadius=UDim.new(1,0); u.Parent=inst; return u end
    local function strokeOf(inst, col, th) local s=Instance.new("UIStroke"); s.Color=col; s.Thickness=th or 1; s.Parent=inst; return s end
    local function padAll(inst, p) local u=Instance.new("UIPadding")
        u.PaddingTop=UDim.new(0,p); u.PaddingBottom=UDim.new(0,p)
        u.PaddingLeft=UDim.new(0,p); u.PaddingRight=UDim.new(0,p); u.Parent=inst; return u end

    local function hoverColor(btn, normal, hi)
        btn.BackgroundColor3 = normal
        btn.MouseEnter:Connect(function() TweenService:Create(btn, TweenInfo.new(0.15), {BackgroundColor3=hi}):Play() end)
        btn.MouseLeave:Connect(function() TweenService:Create(btn, TweenInfo.new(0.15), {BackgroundColor3=normal}):Play() end)
    end
    local function hoverFade(btn) -- прозрачный фон, подсветка при наведении
        btn.BackgroundColor3 = C.surface2; btn.BackgroundTransparency = 1; btn.AutoButtonColor = false
        btn.MouseEnter:Connect(function() TweenService:Create(btn, TweenInfo.new(0.15), {BackgroundTransparency=0}):Play() end)
        btn.MouseLeave:Connect(function() TweenService:Create(btn, TweenInfo.new(0.15), {BackgroundTransparency=1}):Play() end)
    end

    -- ---------- КОНТЕЙНЕР ----------
    local guiParent
    pcall(function() if gethui then guiParent = gethui() end end)
    if not guiParent then pcall(function() guiParent = game:GetService("CoreGui") end) end
    if not guiParent and LocalPlayer then pcall(function() guiParent = LocalPlayer:WaitForChild("PlayerGui", 5) end) end
    if not guiParent then error("нет контейнера для GUI") end

    local oldGui = guiParent:FindFirstChild("RussChatGui"); if oldGui then oldGui:Destroy() end

    local screen = Instance.new("ScreenGui")
    screen.Name = "RussChatGui"; screen.ResetOnSpawn = false
    screen.IgnoreGuiInset = true; screen.DisplayOrder = 9999
    screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
    screen.Parent = guiParent
    pcall(function() if syn and syn.protect_gui then syn.protect_gui(screen) end end)

    -- holder (двигаем его), внутри тень + окно
    local holder = Instance.new("Frame")
    holder.Name = "Holder"; holder.BackgroundTransparency = 1
    holder.Size = UDim2.new(0, 460, 0, 360)
    holder.Position = UDim2.new(0.5, -230, 0.5, -180)
    holder.Active = true; holder.Parent = screen
    local hScale = Instance.new("UIScale"); hScale.Parent = holder

    local shadow = Instance.new("ImageLabel")
    shadow.BackgroundTransparency = 1
    shadow.AnchorPoint = Vector2.new(0.5, 0.5)
    shadow.Position = UDim2.new(0.5, 0, 0.5, 4)
    shadow.Size = UDim2.new(1, 70, 1, 70)
    shadow.Image = "rbxassetid://1316045217"           -- мягкая тень (asset ID)
    shadow.ImageColor3 = Color3.new(0, 0, 0)
    shadow.ImageTransparency = 0.45
    shadow.ScaleType = Enum.ScaleType.Slice
    shadow.SliceCenter = Rect.new(10, 10, 118, 118)
    shadow.ZIndex = 0; shadow.Parent = holder

    local main = Instance.new("Frame")
    main.Size = UDim2.new(1, 0, 1, 0)
    main.BackgroundColor3 = C.bg; main.BorderSizePixel = 0
    main.ZIndex = 1; main.Parent = holder
    round(main, 14); strokeOf(main, C.stroke, 1)
    local mg = Instance.new("UIGradient")
    mg.Color = ColorSequence.new(C.bg, C.bgGrad); mg.Rotation = 90; mg.Parent = main

    -- ---------- ШАПКА ----------
    local header = Instance.new("Frame")
    header.Size = UDim2.new(1, 0, 0, 46); header.BackgroundColor3 = C.surface
    header.BorderSizePixel = 0; header.Active = true; header.ZIndex = 2; header.Parent = main
    round(header, 14)
    local headerFix = Instance.new("Frame") -- скрыть нижнее скругление шапки
    headerFix.Size = UDim2.new(1, 0, 0, 14); headerFix.Position = UDim2.new(0, 0, 1, -14)
    headerFix.BackgroundColor3 = C.surface; headerFix.BorderSizePixel = 0; headerFix.ZIndex = 2; headerFix.Parent = header

    local logo = Instance.new("Frame")
    logo.Size = UDim2.new(0, 8, 0, 22); logo.Position = UDim2.new(0, 16, 0.5, -11)
    logo.BackgroundColor3 = C.accent; logo.BorderSizePixel = 0; logo.ZIndex = 3; logo.Parent = header
    round(logo, 4)

    local title = Instance.new("TextLabel")
    title.BackgroundTransparency = 1; title.Position = UDim2.new(0, 32, 0, 0)
    title.Size = UDim2.new(0, 160, 1, 0); title.Font = Enum.Font.GothamBold
    title.Text = "Russ Chat"; title.TextSize = 17; title.TextColor3 = C.textPri
    title.TextXAlignment = Enum.TextXAlignment.Left; title.ZIndex = 3; title.Parent = header

    local statusDot = Instance.new("Frame")
    statusDot.Size = UDim2.new(0, 8, 0, 8); statusDot.Position = UDim2.new(0, 142, 0.5, -4)
    statusDot.BackgroundColor3 = C.offline; statusDot.BorderSizePixel = 0; statusDot.ZIndex = 3; statusDot.Parent = header
    circle(statusDot)
    local statusTxt = Instance.new("TextLabel")
    statusTxt.BackgroundTransparency = 1; statusTxt.Position = UDim2.new(0, 156, 0, 0)
    statusTxt.Size = UDim2.new(0, 120, 1, 0); statusTxt.Font = Enum.Font.GothamMedium
    statusTxt.Text = "офлайн"; statusTxt.TextSize = 12; statusTxt.TextColor3 = C.textMut
    statusTxt.TextXAlignment = Enum.TextXAlignment.Left; statusTxt.ZIndex = 3; statusTxt.Parent = header

    -- кнопка свернуть (нарисованная линия)
    local minBtn = Instance.new("TextButton")
    minBtn.Size = UDim2.new(0, 30, 0, 30); minBtn.Position = UDim2.new(1, -70, 0.5, -15)
    minBtn.Text = ""; minBtn.ZIndex = 3; minBtn.Parent = header
    round(minBtn, 8); hoverFade(minBtn)
    local minLine = Instance.new("Frame")
    minLine.AnchorPoint = Vector2.new(0.5, 0.5); minLine.Position = UDim2.new(0.5, 0, 0.5, 0)
    minLine.Size = UDim2.new(0, 12, 0, 2); minLine.BackgroundColor3 = C.textMut
    minLine.BorderSizePixel = 0; minLine.ZIndex = 4; minLine.Parent = minBtn; round(minLine, 1)

    -- кнопка закрыть (нарисованный X)
    local closeBtn = Instance.new("TextButton")
    closeBtn.Size = UDim2.new(0, 30, 0, 30); closeBtn.Position = UDim2.new(1, -36, 0.5, -15)
    closeBtn.Text = ""; closeBtn.ZIndex = 3; closeBtn.Parent = header
    round(closeBtn, 8); hoverFade(closeBtn)
    for _, rot in ipairs({45, -45}) do
        local ln = Instance.new("Frame")
        ln.AnchorPoint = Vector2.new(0.5, 0.5); ln.Position = UDim2.new(0.5, 0, 0.5, 0)
        ln.Size = UDim2.new(0, 13, 0, 2); ln.BackgroundColor3 = C.textMut
        ln.BorderSizePixel = 0; ln.Rotation = rot; ln.ZIndex = 4; ln.Parent = closeBtn; round(ln, 1)
    end

    -- ---------- СООБЩЕНИЯ ----------
    local scroll = Instance.new("ScrollingFrame")
    scroll.Position = UDim2.new(0, 6, 0, 52); scroll.Size = UDim2.new(1, -12, 1, -110)
    scroll.BackgroundTransparency = 1; scroll.BorderSizePixel = 0
    scroll.ScrollBarThickness = 4; scroll.ScrollBarImageColor3 = C.surface2
    scroll.CanvasSize = UDim2.new(0, 0, 0, 0); scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
    scroll.ZIndex = 2; scroll.Parent = main
    padAll(scroll, 6)
    local feed = Instance.new("UIListLayout"); feed.Padding = UDim.new(0, 10)
    feed.SortOrder = Enum.SortOrder.LayoutOrder; feed.Parent = scroll

    -- ---------- ВВОД ----------
    local inputBar = Instance.new("Frame")
    inputBar.Position = UDim2.new(0, 12, 1, -50); inputBar.Size = UDim2.new(1, -24, 0, 40)
    inputBar.BackgroundTransparency = 1; inputBar.ZIndex = 2; inputBar.Parent = main

    local boxFrame = Instance.new("Frame")
    boxFrame.Size = UDim2.new(1, -98, 1, 0); boxFrame.BackgroundColor3 = C.surface
    boxFrame.BorderSizePixel = 0; boxFrame.ZIndex = 2; boxFrame.Parent = inputBar
    round(boxFrame, 10); strokeOf(boxFrame, C.stroke, 1)
    local box = Instance.new("TextBox")
    box.BackgroundTransparency = 1; box.Size = UDim2.new(1, 0, 1, 0)
    box.Font = Enum.Font.Gotham; box.PlaceholderText = "Сообщение..."
    box.PlaceholderColor3 = C.textMut; box.Text = ""; box.TextColor3 = C.textPri
    box.TextSize = 14; box.TextXAlignment = Enum.TextXAlignment.Left
    box.ClearTextOnFocus = false; box.ClipsDescendants = true; box.ZIndex = 3; box.Parent = boxFrame
    padAll(box, 12)

    local sendBtn = Instance.new("TextButton")
    sendBtn.Size = UDim2.new(0, 88, 1, 0); sendBtn.Position = UDim2.new(1, -88, 0, 0)
    sendBtn.Font = Enum.Font.GothamBold; sendBtn.Text = "Отправить"; sendBtn.TextSize = 14
    sendBtn.TextColor3 = Color3.new(1, 1, 1); sendBtn.AutoButtonColor = false
    sendBtn.ZIndex = 2; sendBtn.Parent = inputBar
    round(sendBtn, 10); hoverColor(sendBtn, C.accent, C.accentHi)

    -- ============ РЕНДЕР ============
    local function esc(s)
        return (tostring(s):gsub("&","&amp;"):gsub("<","&lt;"):gsub(">","&gt;"))
    end
    local function nameColor(name)
        local h = 0
        for i = 1, #name do h = (h * 31 + string.byte(name, i)) % 360 end
        return Color3.fromHSV(h / 360, 0.5, 0.95)
    end
    local function firstChar(s)
        if utf8 and utf8.offset then
            local e = utf8.offset(s, 2)
            if e then return s:sub(1, e - 1) end
        end
        return s:sub(1, 1)
    end
    local function scrollDown()
        task.defer(function() scroll.CanvasPosition = Vector2.new(0, scroll.AbsoluteCanvasSize.Y) end)
    end

    local idCache = {}
    local function thumbUrl(uid) return "rbxthumb://type=AvatarHeadShot&id=" .. uid .. "&w=100&h=100" end
    local function resolveAvatar(name, img, letter)
        local function apply(uid)
            if uid and img and img.Parent then
                img.Image = thumbUrl(uid); img.ImageTransparency = 0
                if letter then letter.Visible = false end
            end
        end
        if idCache[name] ~= nil then if idCache[name] then apply(idCache[name]) end return end
        task.spawn(function()
            local uid
            if LocalPlayer and name == LocalPlayer.Name then uid = LocalPlayer.UserId
            else
                local okId, res = pcall(function() return Players:GetUserIdFromNameAsync(name) end)
                if okId then uid = res end
            end
            idCache[name] = uid or false
            apply(uid)
        end)
    end

    local order = 0
    local function nextOrder() order += 1; return order end

    local function addChat(m)
        local name = tostring(m.player or "?")
        local row = Instance.new("Frame")
        row.BackgroundTransparency = 1; row.Size = UDim2.new(1, -4, 0, 0)
        row.AutomaticSize = Enum.AutomaticSize.Y; row.LayoutOrder = nextOrder(); row.ZIndex = 2; row.Parent = scroll
        local rl = Instance.new("UIListLayout"); rl.FillDirection = Enum.FillDirection.Horizontal
        rl.VerticalAlignment = Enum.VerticalAlignment.Top; rl.Padding = UDim.new(0, 10); rl.Parent = row

        -- аватар
        local av = Instance.new("Frame")
        av.Size = UDim2.new(0, 36, 0, 36); av.BackgroundColor3 = nameColor(name)
        av.BorderSizePixel = 0; av.LayoutOrder = 1; av.ZIndex = 2; av.Parent = row
        circle(av)
        local letter = Instance.new("TextLabel")
        letter.BackgroundTransparency = 1; letter.Size = UDim2.new(1, 0, 1, 0)
        letter.Font = Enum.Font.GothamBold; letter.Text = string.upper(firstChar(name))
        letter.TextSize = 16; letter.TextColor3 = Color3.new(1, 1, 1); letter.ZIndex = 3; letter.Parent = av
        local img = Instance.new("ImageLabel")
        img.BackgroundTransparency = 1; img.Size = UDim2.new(1, 0, 1, 0)
        img.ImageTransparency = 1; img.ZIndex = 3; img.Parent = av; circle(img)
        resolveAvatar(name, img, letter)

        -- контент
        local content = Instance.new("Frame")
        content.BackgroundTransparency = 1; content.Size = UDim2.new(1, -46, 0, 0)
        content.AutomaticSize = Enum.AutomaticSize.Y; content.LayoutOrder = 2; content.ZIndex = 2; content.Parent = row
        local cl = Instance.new("UIListLayout"); cl.Padding = UDim.new(0, 1)
        cl.SortOrder = Enum.SortOrder.LayoutOrder; cl.Parent = content

        local nm = Instance.new("TextLabel")
        nm.BackgroundTransparency = 1; nm.Size = UDim2.new(1, 0, 0, 16)
        nm.Font = Enum.Font.GothamBold; nm.TextSize = 13
        local rc = C.accent
        if m.role and m.role.color == "GOLD" then rc = Color3.fromRGB(255, 215, 0)
        elseif m.role and m.role.color == "RAINBOW" then rc = Color3.fromRGB(255, 122, 217)
        else rc = nameColor(name) end
        nm.TextColor3 = rc
        nm.Text = name .. ((m.role and m.role.prefix) and ("  ·  " .. m.role.prefix) or "")
        nm.TextXAlignment = Enum.TextXAlignment.Left; nm.LayoutOrder = 1; nm.ZIndex = 2; nm.Parent = content

        local txt = Instance.new("TextLabel")
        txt.BackgroundTransparency = 1; txt.Size = UDim2.new(1, 0, 0, 0)
        txt.AutomaticSize = Enum.AutomaticSize.Y; txt.Font = Enum.Font.Gotham; txt.TextSize = 14
        txt.TextColor3 = C.textPri; txt.Text = tostring(m.msg or "")
        txt.TextWrapped = true; txt.TextXAlignment = Enum.TextXAlignment.Left
        txt.LayoutOrder = 2; txt.ZIndex = 2; txt.Parent = content

        scrollDown()
    end

    local function addBanner(text, col)
        local row = Instance.new("Frame")
        row.BackgroundColor3 = C.surface; row.BackgroundTransparency = 0.3
        row.Size = UDim2.new(1, -4, 0, 0); row.AutomaticSize = Enum.AutomaticSize.Y
        row.LayoutOrder = nextOrder(); row.ZIndex = 2; row.Parent = scroll
        round(row, 8); padAll(row, 8)
        local l = Instance.new("TextLabel")
        l.BackgroundTransparency = 1; l.Size = UDim2.new(1, 0, 0, 0)
        l.AutomaticSize = Enum.AutomaticSize.Y; l.Font = Enum.Font.GothamMedium; l.TextSize = 13
        l.TextColor3 = col or C.textMut; l.Text = text; l.TextWrapped = true
        l.TextXAlignment = Enum.TextXAlignment.Center; l.ZIndex = 2; l.Parent = row
        scrollDown()
    end

    local function setStatus(isOn, label)
        TweenService:Create(statusDot, TweenInfo.new(0.25),
            { BackgroundColor3 = isOn and C.online or C.offline }):Play()
        if label then statusTxt.Text = label end
    end

    -- ============ СОСТОЯНИЕ + API ============
    local token, connected, running, canSend = nil, false, true, true
    local roleInfo, seenIds = nil, {}

    local function apiRequest(method, path, body)
        if not hasHttp then return nil, -1 end
        local headers = { ["User-Agent"] = "RussChatClient/1.0", ["Accept"] = "application/json" }
        if token then headers["X-Auth-Token"] = token end
        if body then headers["Content-Type"] = "application/json" end
        local okReq, res = pcall(function()
            return httpRequest({ Url = CONFIG.SERVER_URL .. path, Method = method,
                Headers = headers, Body = body and HttpService:JSONEncode(body) or nil })
        end)
        if not okReq or not res then return nil, 0 end
        local status = res.StatusCode or res.Status or 0
        local data; if res.Body and #res.Body > 0 then pcall(function() data = HttpService:JSONDecode(res.Body) end) end
        return data, status
    end

    local function login()
        local data, status = apiRequest("POST", "/auth/login", {
            player = USERNAME, adminSecret = (CONFIG.ADMIN_SECRET ~= "" and CONFIG.ADMIN_SECRET) or nil })
        if status == 200 and data and data.token then
            token, roleInfo, connected = data.token, data.role, true; return true
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
        if not connected then addChat({ player = USERNAME, msg = text, role = roleInfo }); return end
        if not canSend then addBanner("Подожди пару секунд", C.warn); return end
        canSend = false; task.delay(3, function() canSend = true end)
        local data, status = apiRequest("POST", "/chat", { message = text })
        if status == 401 then if login() then sendMessage(text) end
        elseif status == 429 then addBanner("Слишком часто — подожди", C.warn)
        elseif status == 403 then addBanner((data and data.error) or "бан/мут", C.offline)
        elseif status == 400 then addBanner((data and data.error) or "сообщение отклонено", C.warn)
        elseif status ~= 200 then addBanner("ошибка отправки (" .. tostring(status) .. ")", C.offline) end
    end

    -- ============ КНОПКИ ============
    local function doSend()
        local t = box.Text
        if not t or #t:gsub("%s", "") == 0 then return end
        box.Text = ""; task.spawn(sendMessage, t)
    end
    sendBtn.MouseButton1Click:Connect(doSend)
    box.FocusLost:Connect(function(enter) if enter then doSend() end end)

    closeBtn.MouseButton1Click:Connect(function()
        running = false
        TweenService:Create(hScale, TweenInfo.new(0.18), { Scale = 0 }):Play()
        task.wait(0.18); screen:Destroy()
    end)
    local minimized = false
    minBtn.MouseButton1Click:Connect(function()
        minimized = not minimized
        TweenService:Create(holder, TweenInfo.new(0.2),
            { Size = UDim2.new(0, 460, 0, minimized and 46 or 360) }):Play()
        scroll.Visible = not minimized; inputBar.Visible = not minimized
    end)

    do -- перетаскивание
        local dragging, dragStart, startPos
        header.InputBegan:Connect(function(i)
            if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
                dragging = true; dragStart = i.Position; startPos = holder.Position
                i.Changed:Connect(function() if i.UserInputState == Enum.UserInputState.End then dragging = false end end)
            end
        end)
        UserInput.InputChanged:Connect(function(i)
            if dragging and (i.UserInputType == Enum.UserInputType.MouseMovement or i.UserInputType == Enum.UserInputType.Touch) then
                local d = i.Position - dragStart
                holder.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X, startPos.Y.Scale, startPos.Y.Offset + d.Y)
            end
        end)
    end

    -- анимация открытия (косметика)
    hScale.Scale = 0.9
    TweenService:Create(hScale, TweenInfo.new(0.25, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()

    -- ============ ЗАПУСК ============
    if not hasHttp then
        setStatus(false, "офлайн")
        addBanner("Твой executor не даёт HTTP. Доступен только офлайн-режим.", C.warn)
    else
        setStatus(false, "подключение...")
        task.spawn(function()
            local okLogin, err = login()
            if not okLogin then
                setStatus(false, "офлайн")
                addBanner(tostring(err) .. " — можешь писать, видно локально", C.offline)
                return
            end
            setStatus(true, "онлайн" .. ((roleInfo and roleInfo.prefix) and (" · " .. roleInfo.prefix) or ""))
            while running do
                pcall(fetchMessages)
                task.wait(math.max(1.5, CONFIG.POLL_INTERVAL))
            end
        end)
    end
end)

if not ok then notify("RussChat: ошибка", tostring(buildErr)) end
