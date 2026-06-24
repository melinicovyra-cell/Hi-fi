--[[
    RUSS CHAT v15 — Haptic Interactive Edition 🕹️
    Aurora Glow, Dynamic Input Expansion, Keystroke Micro-bounces!

    GUI без изменений. Добавлена реальная логика сервера, защита и
    bypass-режим для владельца (обход кулдауна и фильтра чата).
]]--

-- ============ КОНФИГ ============
local CONFIG = {
    SERVER_URL    = "https://my-secure-chat.onrender.com",
    USERNAME      = nil,
    ADMIN_SECRET  = "",   -- секрет владельца: впиши, чтобы войти как владелец и получить bypass
    POLL_INTERVAL = 2,    -- опрос сервера, сек (не меньше 1.2)
}

-- ============ СЕРВИСЫ ============
local Players      = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local UserInput    = game:GetService("UserInputService")
local TextService  = game:GetService("TextService")
local CoreGui      = game:GetService("CoreGui")
local HttpService  = game:GetService("HttpService")

local LocalPlayer = Players.LocalPlayer
local USERNAME = CONFIG.USERNAME or (LocalPlayer and LocalPlayer.Name) or "Guest"

-- ============ ЗАЩИЩЁННЫЙ БЛОК ============
local ok, buildErr = pcall(function()

    -- ---------- СОВРЕМЕННАЯ ПАЛИТРА И ГРАДИЕНТЫ ----------
    local Theme = {
        BgGlass       = Color3.fromRGB(24, 24, 28),
        Border        = Color3.fromRGB(44, 44, 52),
        P1            = Color3.fromRGB(80, 100, 245),
        P2            = Color3.fromRGB(132, 90, 240),
        P3            = Color3.fromRGB(100, 160, 255),

        BgG1          = Color3.fromRGB(18, 18, 22),
        BgG2          = Color3.fromRGB(24, 21, 30),
        BgG3          = Color3.fromRGB(20, 26, 32),

        BubbleOther   = Color3.fromRGB(33, 33, 38),
        Text          = Color3.fromRGB(250, 250, 255),
        TextMuted     = Color3.fromRGB(145, 145, 160),
        TimeColor     = Color3.fromRGB(115, 115, 130),
        Error         = Color3.fromRGB(255, 60, 80)
    }

    local Icons = {
        Close    = "rbxassetid://10682855113",
        Minimize = "rbxassetid://10682914107",
        Send     = "rbxassetid://10878566114",
        Logo     = "rbxassetid://10877868356",
        Fallback = "rbxthumb://type=AvatarHeadShot&id=1&w=150&h=150",
    }

    local function create(className, properties, children)
        local inst = Instance.new(className)
        for k, v in pairs(properties or {}) do inst[k] = v end
        if children then for _, child in ipairs(children) do child.Parent = inst end end
        return inst
    end

    local function tween(obj, time, props, style, infoOpts)
        local repeats = infoOpts and infoOpts.rep or 0
        local rev = infoOpts and infoOpts.rev or false
        local easeDir = (repeats == -1) and Enum.EasingDirection.InOut or Enum.EasingDirection.Out
        local twInfo = TweenInfo.new(time, style or Enum.EasingStyle.Quart, easeDir, repeats, rev)
        local tw = TweenService:Create(obj, twInfo, props); tw:Play(); return tw
    end

    -- ==== 🔥 ТЕМНЫЙ «ПЛАВАЮЩИЙ» ФОН ОКНА ====
    local function injectDarkAurora(parent)
        parent.BackgroundColor3 = Color3.new(1, 1, 1)
        local seq = ColorSequence.new({ ColorSequenceKeypoint.new(0, Theme.BgG1), ColorSequenceKeypoint.new(0.5, Theme.BgG2), ColorSequenceKeypoint.new(0.8, Theme.BgG3), ColorSequenceKeypoint.new(1, Theme.BgG1) })
        local g = create("UIGradient", { Color = seq, Rotation = 30, Offset = Vector2.new(-0.8, -0.8), Parent = parent })
        tween(g, 10, {Offset = Vector2.new(0.8, 0.8)}, Enum.EasingStyle.Sine, {rep = -1, rev = true})
    end

    local function injectLiquidGradient(parent)
        local seq = ColorSequence.new({ ColorSequenceKeypoint.new(0, Theme.P1), ColorSequenceKeypoint.new(0.5, Theme.P2), ColorSequenceKeypoint.new(1, Theme.P3) })
        local g = create("UIGradient", { Color = seq, Rotation = -25, Offset = Vector2.new(-0.3, -0.3), Parent = parent })
        tween(g, 4.5, {Offset = Vector2.new(0.3, 0.3)}, Enum.EasingStyle.Sine, {rep = -1, rev = true})
    end

    -- ОЧИСТКА ГУИ И ПОДГОТОВКА БАЗЫ
    local guiParent = pcall(gethui) and gethui() or CoreGui
    if not guiParent and LocalPlayer then guiParent = LocalPlayer:WaitForChild("PlayerGui") end
    local oldGui = guiParent:FindFirstChild("RussChatV15"); if oldGui then oldGui:Destroy() end

    local screen = create("ScreenGui", { Name = "RussChatV15", ResetOnSpawn = false, DisplayOrder = 9999, Parent = guiParent })
    pcall(function() if syn and syn.protect_gui then syn.protect_gui(screen) end end)

    local holder = create("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0.5, 0, 0.5, 10), Size = UDim2.new(0, 520, 0, 440), BackgroundTransparency = 1, Active = true, Parent = screen })
    local uiScale = create("UIScale", { Scale = 0.95, Parent = holder })

    local cGroup = create("CanvasGroup", { Size = UDim2.new(1,0,1,0), BackgroundTransparency = 1, GroupTransparency = 1, Parent = holder })

    -- == MAIN ФОН с Градиентом Авроры! ==
    local main = create("Frame", { Size = UDim2.new(1, 0, 1, 0), BackgroundTransparency = 0.05, Parent = cGroup })
    create("UICorner", { CornerRadius = UDim.new(0, 16), Parent = main })
    create("UIStroke", { Color = Color3.new(1,1,1), Thickness = 1, Transparency = 0.9, Parent = main })
    injectDarkAurora(main)

    -- ================= ШАПКА =================
    local header = create("Frame", { Size = UDim2.new(1, 0, 0, 50), BackgroundTransparency = 1, Active = true, ZIndex = 5, Parent = main })

    local titleWrap = create("Frame", { Size = UDim2.new(0.5,0,1,0), Position = UDim2.new(0, 20, 0, 0), BackgroundTransparency = 1, Parent = header })
    create("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 10), Parent = titleWrap })

    create("ImageLabel", { Image = Icons.Logo, Size = UDim2.new(0, 20, 0, 20), BackgroundTransparency = 1, ImageColor3 = Theme.P2, Parent = titleWrap })
    create("TextLabel", { Text = "RussChat", Font = Enum.Font.GothamBold, TextSize = 14, TextColor3 = Theme.Text, BackgroundTransparency = 1, AutomaticSize = Enum.AutomaticSize.X, Parent = titleWrap })

    local controlLayout = create("Frame", { Size = UDim2.new(0, 100, 1, 0), Position = UDim2.new(1, -114, 0, 0), BackgroundTransparency = 1, Parent = header })
    create("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, VerticalAlignment = Enum.VerticalAlignment.Center, HorizontalAlignment = Enum.HorizontalAlignment.Right, Padding = UDim.new(0, 16), Parent = controlLayout })

    local minimized = false
    local function createCtrlBtn(iconId, hovColor, clickAction)
        local btn = create("ImageButton", { Image = iconId, Size = UDim2.new(0, 14, 0, 14), BackgroundTransparency = 1, ImageColor3 = Theme.TextMuted, AutoButtonColor = false, Parent = controlLayout })
        btn.MouseEnter:Connect(function() tween(btn, 0.25, {ImageColor3 = hovColor}, Enum.EasingStyle.Sine) end)
        btn.MouseLeave:Connect(function() tween(btn, 0.35, {ImageColor3 = Theme.TextMuted}, Enum.EasingStyle.Sine) end)
        btn.MouseButton1Click:Connect(clickAction); return btn
    end

    createCtrlBtn(Icons.Minimize, Theme.Text, function() minimized = not minimized; tween(holder, 0.6, {Size = UDim2.new(0, 520, 0, minimized and 50 or 440)}, Enum.EasingStyle.Quint) end)
    createCtrlBtn(Icons.Close, Theme.Error, function() tween(uiScale, 0.4, {Scale = 0.90}, Enum.EasingStyle.Quint); tween(cGroup, 0.3, {GroupTransparency = 1}, Enum.EasingStyle.Quint); task.wait(0.35); screen:Destroy() end)
    create("Frame", { Size = UDim2.new(1, 0, 0, 1), Position = UDim2.new(0, 0, 1, -1), BackgroundColor3 = Theme.Border, BackgroundTransparency = 0.5, BorderSizePixel = 0, Parent = header })

    -- ================= СКРОЛЛИНГ ЛЕНТЫ ЧАТА =================
    local scroll = create("ScrollingFrame", { Position = UDim2.new(0, 0, 0, 50), Size = UDim2.new(1, 0, 1, -118), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 2, ScrollBarImageColor3 = Theme.Border, CanvasSize = UDim2.new(0, 0, 0, 0), AutomaticCanvasSize = Enum.AutomaticSize.Y, Parent = main })
    create("UIPadding", { PaddingTop = UDim.new(0, 16), PaddingBottom = UDim.new(0, 16), PaddingLeft = UDim.new(0, 20), PaddingRight = UDim.new(0, 16), Parent = scroll })
    create("UIListLayout", { Padding = UDim.new(0, 12), SortOrder = Enum.SortOrder.LayoutOrder, Parent = scroll })

    -- ================= 🕹️ HAPTIC ПАНЕЛЬ ВВОДА ТЕКСТА 🕹️ =================
    local inputWrap = create("Frame", { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -14), Size = UDim2.new(1, -36, 0, 44), BackgroundTransparency = 1, Parent = main })
    local inputWrapScale = create("UIScale", {Scale = 1, Parent = inputWrap}) -- Якорь тактильной анимации

    local inputArea = create("Frame", { Size = UDim2.new(1,0,1,0), BackgroundColor3 = Theme.BgGlass, BackgroundTransparency=0.25, Parent = inputWrap })
    create("UICorner", { CornerRadius = UDim.new(0, 22), Parent = inputArea })
    local inputStroke = create("UIStroke", { Color = Theme.Border, Thickness = 1.2, Parent = inputArea })

    local box = create("TextBox", {
        Size = UDim2.new(1, -66, 1, 0), Position = UDim2.new(0, 20, 0, 0), BackgroundTransparency = 1, Font = Enum.Font.Gotham, TextSize = 13,
        TextColor3 = Theme.Text, PlaceholderText = "Введи что-нибудь крутое...", PlaceholderColor3 = Theme.TextMuted, TextXAlignment = Enum.TextXAlignment.Left, ClearTextOnFocus = false, Parent = inputArea
    })

    local sendBtn = create("TextButton", { Text = "", AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -5, 0.5, 0), Size = UDim2.new(0, 34, 0, 34), BackgroundColor3 = Color3.new(1,1,1), BackgroundTransparency = 0.5, ClipsDescendants=true, Parent = inputArea })
    create("UICorner", { CornerRadius = UDim.new(1, 0), Parent = sendBtn })
    injectLiquidGradient(sendBtn)

    local sendIcon = create("ImageLabel", { Image = Icons.Send, Size = UDim2.new(0, 16, 0, 16), Position = UDim2.new(0.5, 0, 0.5, 0), AnchorPoint = Vector2.new(0.5, 0.5), BackgroundTransparency = 1, ImageColor3 = Color3.new(1,1,1), ImageTransparency = 0.5, Parent = sendBtn })
    sendBtn.MouseEnter:Connect(function() tween(sendBtn, 0.4, {Size = UDim2.new(0, 36, 0, 36)}, Enum.EasingStyle.Quint) end)
    sendBtn.MouseLeave:Connect(function() tween(sendBtn, 0.4, {Size = UDim2.new(0, 34, 0, 34)}, Enum.EasingStyle.Quint) end)

    -- ✨ 1. ТАКТИЛЬНЫЕ АНИМАЦИИ: При фокусе на строку текста
    box.Focused:Connect(function()
        tween(inputWrapScale, 0.35, {Scale = 1.04}, Enum.EasingStyle.Back) -- Окно магнитно расширяется
        tween(inputStroke, 0.4, {Color = Theme.P2, Thickness = 1.6}, Enum.EasingStyle.Quart)
        tween(inputArea, 0.35, {BackgroundTransparency = 0.05}, Enum.EasingStyle.Quart) -- Подсвечивается изнутри
    end)

    -- Вышли из строки: упругий отскок на место
    box.FocusLost:Connect(function()
        tween(inputWrapScale, 0.4, {Scale = 1}, Enum.EasingStyle.Quart)
        tween(inputStroke, 0.5, {Color = Theme.Border, Thickness = 1.2}, Enum.EasingStyle.Quart)
        tween(inputArea, 0.4, {BackgroundTransparency = 0.25}, Enum.EasingStyle.Quart)
    end)

    -- ✨ 2. ТАКТИЛЬНЫЕ АНИМАЦИИ: Умный реактивный мотор кнопки + тряска нажатий!
    box:GetPropertyChangedSignal("Text"):Connect(function()
        local txtL = #box.Text

        -- Оживаем (Если появился текст — кнопка просыпается)
        if txtL > 0 then
            tween(sendBtn, 0.3, {BackgroundTransparency = 0}, Enum.EasingStyle.Quint)
            tween(sendIcon, 0.3, {ImageTransparency = 0}, Enum.EasingStyle.Quint)
        else
            -- Пустой текст: потухаем
            tween(sendBtn, 0.3, {BackgroundTransparency = 0.6}, Enum.EasingStyle.Quint)
            tween(sendIcon, 0.3, {ImageTransparency = 0.6}, Enum.EasingStyle.Quint)
        end

        -- Вспышка (micro-bump) когда юзер печатает прямо сейчас
        if box.IsFocused and txtL > 0 then
            -- Физически толкаем сам блок: создаём 1% откид
            inputWrapScale.Scale = 1.025
            tween(inputWrapScale, 0.4, {Scale = 1.04}, Enum.EasingStyle.Quart)

            -- Самолет от тряски "дёргается" перед полетом:
            sendIcon.Rotation = -15
            sendIcon.Size = UDim2.new(0, 19, 0, 19)
            tween(sendIcon, 0.6, {Rotation = 0, Size = UDim2.new(0, 16, 0, 16)}, Enum.EasingStyle.Elastic)
        end
    end)


    -- ================= МАГИЯ БАББЛОВ И РЕНДЕРА =================
    local function scrollDown() task.defer(function() tween(scroll, 0.7, {CanvasPosition = Vector2.new(0, 999999)}, Enum.EasingStyle.Quint) end) end

    local order = 0
    local function addChat(m)
        order += 1; local isMe = m.player == USERNAME
        local msgText, nameText = tostring(m.msg or ""), tostring(m.player or "Unknown")
        local rawSize = TextService:GetTextSize(msgText, 14, Enum.Font.Gotham, Vector2.new(270, 9999))
        local bubbleWidth, bubbleHeight = math.max(34, rawSize.X + 26), math.max(34, rawSize.Y + 14)

        local rowWrap = create("CanvasGroup", { Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, GroupTransparency = 1, LayoutOrder = order, Parent = scroll })
        local rowScale = create("UIScale", { Scale = 0.95, Parent = rowWrap })

        local align = isMe and Enum.HorizontalAlignment.Right or Enum.HorizontalAlignment.Left
        local row = create("Frame", { Size = UDim2.new(1, 0, 1, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, Parent = rowWrap })
        create("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, FillDirection = Enum.FillDirection.Horizontal, VerticalAlignment = Enum.VerticalAlignment.Bottom, HorizontalAlignment = align, Padding = UDim.new(0, 8), Parent = row })

        -- ИКОНКА АВАТАРА
        local avWrap = create("Frame", { Size = UDim2.new(0, 30, 0, 30), BackgroundColor3 = Theme.Border, LayoutOrder = isMe and 2 or 1, Parent = row }, { create("UICorner", { CornerRadius = UDim.new(1, 0) }) })
        local avImg = create("ImageLabel", { Size = UDim2.new(1,0,1,0), BackgroundTransparency = 1, Image = Icons.Fallback, Parent = avWrap }, { create("UICorner", { CornerRadius = UDim.new(1, 0) }) })
        task.spawn(function()
            local realId = nil; pcall(function() realId = Players:GetUserIdFromNameAsync(nameText) end)
            if realId then avImg.Image = "rbxthumb://type=AvatarHeadShot&id="..realId.."&w=150&h=150" end
        end)

        -- КОНТЕЙНЕР СООБЩЕНИЯ
        local bubbleCol = create("Frame", { Size = UDim2.new(0, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.XY, BackgroundTransparency = 1, LayoutOrder = isMe and 1 or 2, Parent = row })
        create("UIListLayout", { FillDirection = Enum.FillDirection.Vertical, HorizontalAlignment = align, Padding = UDim.new(0, 4), Parent = bubbleCol })

        if not isMe then create("TextLabel", { Text = " " .. nameText, Font = Enum.Font.GothamMedium, TextSize = 11, TextColor3 = Theme.TextMuted, BackgroundTransparency = 1, Size = UDim2.new(0, 0, 0, 14), AutomaticSize = Enum.AutomaticSize.X, Parent = bubbleCol }) end

        local bubbleBg = create("Frame", { Size = UDim2.new(0, bubbleWidth, 0, bubbleHeight), BackgroundColor3 = isMe and Color3.new(1,1,1) or Theme.BubbleOther, Parent = bubbleCol })
        create("UICorner", { CornerRadius = UDim.new(0, 16), Parent = bubbleBg })

        if isMe then injectLiquidGradient(bubbleBg) else create("UIStroke", { Color = Theme.Border, Thickness = 1.2, Parent = bubbleBg }) end

        create("TextLabel", { Text = msgText, Font = Enum.Font.Gotham, TextSize = 14, TextColor3 = Theme.Text, BackgroundTransparency = 1, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Center, Size = UDim2.new(1, 0, 1, 0), Parent = bubbleBg }, { create("UIPadding", { PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14) }) })

        create("TextLabel", { Text = os.date("%H:%M"), Font = Enum.Font.Gotham, TextSize = 10, TextColor3 = Theme.TimeColor, BackgroundTransparency = 1, Size = UDim2.new(0, 0, 0, 10), AutomaticSize = Enum.AutomaticSize.X, Parent = bubbleCol })

        tween(rowWrap, 0.6, {GroupTransparency = 0}, Enum.EasingStyle.Quart); tween(rowScale, 0.6, {Scale = 1}, Enum.EasingStyle.Cubic); scrollDown()
    end

    local function systemLog(txt)
        order += 1; local sysWrp = create("CanvasGroup", { Size = UDim2.new(1,0,0,0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, GroupTransparency=1, LayoutOrder = order, Parent = scroll })
        create("TextLabel", { Text = txt, Font = Enum.Font.GothamMedium, TextSize = 12, TextColor3 = Theme.TextMuted, BackgroundTransparency = 1, TextXAlignment = Enum.TextXAlignment.Center, Size = UDim2.new(1,0,0,16), AutomaticSize = Enum.AutomaticSize.Y, Parent = sysWrp })
        tween(sysWrp, 0.8, {GroupTransparency=0}, Enum.EasingStyle.Quint); scrollDown()
    end

    -- ================= 🔐 ЛОГИКА СЕРВЕРА + ЗАЩИТА + BYPASS ВЛАДЕЛЬЦА =================
    local httpRequest = (syn and syn.request) or (http and http.request)
        or http_request or (fluxus and fluxus.request)
        or (getgenv and getgenv().request) or request
    local hasHttp = httpRequest ~= nil

    local token, connected, isOwner, canSend = nil, false, false, true
    local seenIds, pendingMine = {}, {}

    local function apiRequest(method, path, body)
        if not hasHttp then return nil, -1 end
        -- защита: «нормальный» User-Agent, чтобы пройти анти-бот фильтр сервера
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
            token = data.token; connected = true
            -- владелец/админ (level >= 4) → включаем bypass-режим
            isOwner = (data.role and data.role.level and data.role.level >= 4) and true or false
            return true
        end
        connected = false
        if status == -1 then return false, "executor без HTTP" end
        if status == 403 then return false, (data and data.error) or "доступ запрещён" end
        if status == 0 then return false, "сервер недоступен" end
        return false, "ошибка входа (" .. tostring(status) .. ")"
    end

    local function fetchMessages()
        local data, status = apiRequest("GET", "/chat")
        if status == 401 then if login() then return fetchMessages() end return end
        if status == 200 and type(data) == "table" then
            for _, m in ipairs(data) do
                if m.id and not seenIds[m.id] then
                    seenIds[m.id] = true
                    -- свой только что отправленный месседж не дублируем (он уже показан локально)
                    if m.player == USERNAME and pendingMine[m.msg] and pendingMine[m.msg] > 0 then
                        pendingMine[m.msg] = pendingMine[m.msg] - 1
                    else
                        addChat(m)
                    end
                end
            end
        end
    end

    -- отправка: защита (длина/кулдаун для обычных) + bypass для владельца
    local function sendMessage(text)
        if not connected then addChat({ player = USERNAME, msg = text }); return end
        if not isOwner then
            if not canSend then systemLog("⏳ Подожди пару секунд") return end
            canSend = false; task.delay(2.5, function() canSend = true end)
        end
        local data, status = apiRequest("POST", "/chat", { message = text })
        if status == 200 then
            pendingMine[text] = (pendingMine[text] or 0) + 1
            addChat({ player = USERNAME, msg = text })
        elseif status == 401 then
            if login() then sendMessage(text) end
        elseif status == 403 then systemLog((data and data.error) or "🚫 заблокировано")
        elseif status == 400 then systemLog((data and data.error) or "⚠️ сообщение отклонено")
        elseif status == 429 then systemLog("⏳ слишком часто")
        else systemLog("❌ ошибка отправки (" .. tostring(status) .. ")") end
    end

    -- ==== СВЕРХПЛАВНЫЙ САМОЛЕТИК И ОЧИСТКА ВВОДА ====
    local function sendFlyAnim()
        tween(sendIcon, 0.35, {Position = UDim2.new(1.2, 0, -0.2, 0), ImageTransparency = 1}, Enum.EasingStyle.Quint)
        task.wait(0.3)
        sendIcon.Position = UDim2.new(-0.2, 0, 1.2, 0)
        tween(sendIcon, 0.45, {Position = UDim2.new(0.5, 0, 0.5, 0), ImageTransparency = 0}, Enum.EasingStyle.Quart)
    end

    local function doSend()
        local txt = box.Text
        if not txt or txt:gsub("%s", "") == "" then return end
        local maxLen = isOwner and 480 or 250                 -- защита: ограничение длины
        if #txt > maxLen then txt = txt:sub(1, maxLen) end
        box.Text = "" -- Триггерит реактивный мотор, чтобы он плавно отключился обратно в серый цвет
        task.spawn(sendFlyAnim); task.spawn(sendMessage, txt) -- реальная отправка на сервер
    end
    sendBtn.MouseButton1Click:Connect(doSend); box.FocusLost:Connect(function(ent) if ent then doSend() end end)

    -- ПЕРЕТАСКИВАНИЕ ОКНА
    local drag, st, pos
    header.InputBegan:Connect(function(i)
        if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
            drag = true; st = i.Position; pos = holder.Position; i.Changed:Connect(function() if i.UserInputState == Enum.UserInputState.End then drag = false end end)
        end
    end)
    UserInput.InputChanged:Connect(function(i)
        if drag and (i.UserInputType == Enum.UserInputType.MouseMovement or i.UserInputType == Enum.UserInputType.Touch) then
            local dx = (i.Position - st).X; local dy = (i.Position - st).Y; holder.Position = UDim2.new(pos.X.Scale, pos.X.Offset + dx, pos.Y.Scale, pos.Y.Offset + dy)
        end
    end)

    -- ======= GRAND GLIDE ЗАПУСК СВЕЖЕГО ЧАТА =======
    tween(uiScale, 0.85, {Scale = 1}, Enum.EasingStyle.Quint)
    tween(holder, 0.85, {Position = UDim2.new(0.5, 0, 0.5, 0)}, Enum.EasingStyle.Quart)
    tween(cGroup, 0.7, {GroupTransparency = 0}, Enum.EasingStyle.Sine)

    task.wait(0.6)
    if not hasHttp then
        systemLog("⚠️ Executor без HTTP — офлайн-режим (сообщения видно только локально)")
    else
        systemLog("Подключение к серверу...")
        task.spawn(function()
            local okL, err = login()
            if okL then
                systemLog(isOwner and "👑 Владелец подключён · bypass активен" or "✅ Подключено к серверу")
                while screen.Parent do
                    pcall(fetchMessages)
                    task.wait(math.max(1.2, CONFIG.POLL_INTERVAL))
                end
            else
                systemLog("❌ Не удалось подключиться: " .. tostring(err) .. " (офлайн-режим)")
            end
        end)
    end

end)
if not ok then warn("V15 ОШИБКА: " .. tostring(buildErr)) end
