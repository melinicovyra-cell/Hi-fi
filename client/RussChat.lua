--[[
    RUSS CHAT  v4  —  клиент для Ultra-Secure Chat Server
    Дизайн в стиле KR_BACKDOOR loader, но в синем неоне.
    Запускать через executor (инжектор) Roblox.

    Поменяй CONFIG.SERVER_URL на адрес своего сервера на Render.
]]--

-- ============ КОНФИГ ============
local CONFIG = {
    SERVER_URL    = "https://secure-chat-server.onrender.com",
    USERNAME      = nil,
    ADMIN_SECRET  = "",
    POLL_INTERVAL = 2,
    VERSION       = "v1.0",
    AUTHOR        = "Created by KRSP Team",
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

    -- ---------- ПАЛИТРА (синий неон) ----------
    local C = {
        bg0      = Color3.fromRGB(8, 10, 16),
        bg1      = Color3.fromRGB(12, 16, 30),
        surface  = Color3.fromRGB(20, 25, 40),
        surface2 = Color3.fromRGB(28, 35, 56),
        stroke   = Color3.fromRGB(36, 46, 74),
        blue     = Color3.fromRGB(38, 130, 255),
        blueHi   = Color3.fromRGB(90, 170, 255),
        textPri  = Color3.fromRGB(234, 240, 250),
        textMut  = Color3.fromRGB(140, 152, 176),
        online   = Color3.fromRGB(63, 185, 80),
        offline  = Color3.fromRGB(235, 86, 78),
        warn     = Color3.fromRGB(232, 196, 92),
    }
    local GLOW_IMG = "rbxassetid://1316045217"
    local SLICE = Rect.new(10, 10, 118, 118)

    local function round(i, r) local u=Instance.new("UICorner"); u.CornerRadius=UDim.new(0,r); u.Parent=i; return u end
    local function circle(i) local u=Instance.new("UICorner"); u.CornerRadius=UDim.new(1,0); u.Parent=i; return u end
    local function stroke(i, col, th, tr) local s=Instance.new("UIStroke"); s.Color=col; s.Thickness=th or 1; s.Transparency=tr or 0; s.Parent=i; return s end
    local function pad(i, p) local u=Instance.new("UIPadding")
        u.PaddingTop=UDim.new(0,p); u.PaddingBottom=UDim.new(0,p); u.PaddingLeft=UDim.new(0,p); u.PaddingRight=UDim.new(0,p); u.Parent=i; return u end
    local function glow(parent, color, transparency, expand, zindex)
        local g = Instance.new("ImageLabel")
        g.BackgroundTransparency = 1
        g.AnchorPoint = Vector2.new(0.5, 0.5)
        g.Position = UDim2.new(0.5, 0, 0.5, 0)
        g.Size = UDim2.new(1, expand or 60, 1, expand or 60)
        g.Image = GLOW_IMG; g.ImageColor3 = color; g.ImageTransparency = transparency
        g.ScaleType = Enum.ScaleType.Slice; g.SliceCenter = SLICE
        g.ZIndex = zindex or 0; g.Parent = parent
        return g
    end
    local function hoverColor(btn, normal, hi)
        btn.BackgroundColor3 = normal; btn.AutoButtonColor = false
        btn.MouseEnter:Connect(function() TweenService:Create(btn, TweenInfo.new(0.15), {BackgroundColor3=hi}):Play() end)
        btn.MouseLeave:Connect(function() TweenService:Create(btn, TweenInfo.new(0.15), {BackgroundColor3=normal}):Play() end)
    end
    local function hoverFade(btn)
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
    screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling; screen.Parent = guiParent
    pcall(function() if syn and syn.protect_gui then syn.protect_gui(screen) end end)

    local holder = Instance.new("Frame")
    holder.BackgroundTransparency = 1
    holder.Size = UDim2.new(0, 520, 0, 380)
    holder.Position = UDim2.new(0.5, -260, 0.5, -190)
    holder.Active = true; holder.Parent = screen
    local hScale = Instance.new("UIScale"); hScale.Parent = holder

    -- неоновый ореол вокруг панели
    glow(holder, C.blue, 0.35, 90, 0)

    local main = Instance.new("Frame")
    main.Size = UDim2.new(1, 0, 1, 0); main.BackgroundColor3 = C.bg0
    main.BorderSizePixel = 0; main.ClipsDescendants = true; main.ZIndex = 1; main.Parent = holder
    round(main, 16)
    stroke(main, C.blue, 1.6, 0.05)
    local mg = Instance.new("UIGradient")
    mg.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, C.bg1),
        ColorSequenceKeypoint.new(0.5, C.bg0),
        ColorSequenceKeypoint.new(1, Color3.fromRGB(14, 12, 22)),
    }
    mg.Rotation = 90; mg.Parent = main
    -- лёгкое синее свечение от центра (имитация радиального)
    glow(main, C.blue, 0.86, -40, 1)

    --====================================================--
    --                  ЭКРАН ЗАГРУЗКИ                     --
    --====================================================--
    local loader = Instance.new("Frame")
    loader.BackgroundTransparency = 1; loader.Size = UDim2.new(1, 0, 1, 0)
    loader.ZIndex = 2; loader.Parent = main

    -- заголовок + его свечение
    local titleGlow = Instance.new("ImageLabel")
    titleGlow.BackgroundTransparency = 1; titleGlow.AnchorPoint = Vector2.new(0.5, 0.5)
    titleGlow.Position = UDim2.new(0.5, 0, 0, 92); titleGlow.Size = UDim2.new(0, 360, 0, 120)
    titleGlow.Image = GLOW_IMG; titleGlow.ImageColor3 = C.blue; titleGlow.ImageTransparency = 0.55
    titleGlow.ScaleType = Enum.ScaleType.Slice; titleGlow.SliceCenter = SLICE
    titleGlow.ZIndex = 2; titleGlow.Parent = loader

    local bigTitle = Instance.new("TextLabel")
    bigTitle.BackgroundTransparency = 1; bigTitle.AnchorPoint = Vector2.new(0.5, 0.5)
    bigTitle.Position = UDim2.new(0.5, 0, 0, 92); bigTitle.Size = UDim2.new(1, -40, 0, 60)
    bigTitle.Font = Enum.Font.GothamBlack; bigTitle.Text = "RUSS CHAT"
    bigTitle.TextSize = 44; bigTitle.TextColor3 = C.blueHi
    bigTitle.ZIndex = 3; bigTitle.Parent = loader
    stroke(bigTitle, C.blue, 1.4)

    -- бейдж версии + автор
    local badge = Instance.new("TextLabel")
    badge.AnchorPoint = Vector2.new(0.5, 0.5); badge.Position = UDim2.new(0.5, -90, 0, 138)
    badge.Size = UDim2.new(0, 58, 0, 24); badge.BackgroundColor3 = C.blue
    badge.Font = Enum.Font.GothamBold; badge.Text = CONFIG.VERSION; badge.TextSize = 13
    badge.TextColor3 = Color3.new(1, 1, 1); badge.ZIndex = 3; badge.Parent = loader
    round(badge, 6)
    local author = Instance.new("TextLabel")
    author.BackgroundTransparency = 1; author.AnchorPoint = Vector2.new(0, 0.5)
    author.Position = UDim2.new(0.5, -52, 0, 138); author.Size = UDim2.new(0, 220, 0, 20)
    author.Font = Enum.Font.GothamMedium; author.Text = CONFIG.AUTHOR; author.TextSize = 13
    author.TextColor3 = C.textMut; author.TextXAlignment = Enum.TextXAlignment.Left
    author.ZIndex = 3; author.Parent = loader

    -- спиннер (синее кольцо со светящейся дугой)
    local spinner = Instance.new("Frame")
    spinner.BackgroundTransparency = 1; spinner.Position = UDim2.new(0, 60, 0, 196)
    spinner.Size = UDim2.new(0, 64, 0, 64); spinner.ZIndex = 3; spinner.Parent = loader
    circle(spinner)
    local spStroke = stroke(spinner, C.blue, 5)
    local spGrad = Instance.new("UIGradient")
    spGrad.Transparency = NumberSequence.new{
        NumberSequenceKeypoint.new(0, 1),
        NumberSequenceKeypoint.new(0.5, 0),
        NumberSequenceKeypoint.new(1, 1),
    }
    spGrad.Parent = spStroke

    -- статус
    local statusBig = Instance.new("TextLabel")
    statusBig.BackgroundTransparency = 1; statusBig.Position = UDim2.new(0, 140, 0, 214)
    statusBig.Size = UDim2.new(1, -180, 0, 28); statusBig.Font = Enum.Font.GothamBold
    statusBig.Text = "Подключение..."; statusBig.TextSize = 16; statusBig.TextColor3 = C.textPri
    statusBig.TextXAlignment = Enum.TextXAlignment.Left; statusBig.ZIndex = 3; statusBig.Parent = loader

    -- полоса прогресса
    local track = Instance.new("Frame")
    track.AnchorPoint = Vector2.new(0.5, 0); track.Position = UDim2.new(0.5, 0, 0, 288)
    track.Size = UDim2.new(1, -120, 0, 8); track.BackgroundColor3 = C.surface
    track.BorderSizePixel = 0; track.ZIndex = 3; track.Parent = loader
    round(track, 4)
    local fill = Instance.new("Frame")
    fill.Size = UDim2.new(0, 0, 1, 0); fill.BackgroundColor3 = C.blue
    fill.BorderSizePixel = 0; fill.ZIndex = 4; fill.Parent = track
    round(fill, 4); glow(fill, C.blue, 0.4, 20, 3)

    --====================================================--
    --                    ОКНО ЧАТА                        --
    --====================================================--
    local chatView = Instance.new("Frame")
    chatView.BackgroundTransparency = 1; chatView.Size = UDim2.new(1, 0, 1, 0)
    chatView.Visible = false; chatView.ZIndex = 2; chatView.Parent = main

    -- шапка
    local header = Instance.new("Frame")
    header.Size = UDim2.new(1, 0, 0, 48); header.BackgroundColor3 = C.surface
    header.BackgroundTransparency = 0.25; header.BorderSizePixel = 0
    header.Active = true; header.ZIndex = 3; header.Parent = chatView
    local hb = Instance.new("Frame") -- нижняя линия-акцент
    hb.Size = UDim2.new(1, 0, 0, 1); hb.Position = UDim2.new(0, 0, 1, -1)
    hb.BackgroundColor3 = C.blue; hb.BackgroundTransparency = 0.4; hb.BorderSizePixel = 0
    hb.ZIndex = 4; hb.Parent = header

    local logo = Instance.new("Frame")
    logo.Size = UDim2.new(0, 6, 0, 20); logo.Position = UDim2.new(0, 16, 0.5, -10)
    logo.BackgroundColor3 = C.blue; logo.BorderSizePixel = 0; logo.ZIndex = 4; logo.Parent = header
    round(logo, 3); glow(logo, C.blue, 0.4, 16, 3)

    local hTitle = Instance.new("TextLabel")
    hTitle.BackgroundTransparency = 1; hTitle.Position = UDim2.new(0, 30, 0, 0)
    hTitle.Size = UDim2.new(0, 150, 1, 0); hTitle.Font = Enum.Font.GothamBold
    hTitle.Text = "RUSS CHAT"; hTitle.TextSize = 16; hTitle.TextColor3 = C.blueHi
    hTitle.TextXAlignment = Enum.TextXAlignment.Left; hTitle.ZIndex = 4; hTitle.Parent = header

    local hVer = Instance.new("TextLabel")
    hVer.BackgroundColor3 = C.blue; hVer.Position = UDim2.new(0, 130, 0.5, -10)
    hVer.Size = UDim2.new(0, 42, 0, 20); hVer.Font = Enum.Font.GothamBold
    hVer.Text = CONFIG.VERSION; hVer.TextSize = 11; hVer.TextColor3 = Color3.new(1,1,1)
    hVer.ZIndex = 4; hVer.Parent = header; round(hVer, 5)

    local statusDot = Instance.new("Frame")
    statusDot.Size = UDim2.new(0, 8, 0, 8); statusDot.Position = UDim2.new(0, 182, 0.5, -4)
    statusDot.BackgroundColor3 = C.offline; statusDot.BorderSizePixel = 0; statusDot.ZIndex = 4; statusDot.Parent = header
    circle(statusDot)
    local statusTxt = Instance.new("TextLabel")
    statusTxt.BackgroundTransparency = 1; statusTxt.Position = UDim2.new(0, 196, 0, 0)
    statusTxt.Size = UDim2.new(0, 140, 1, 0); statusTxt.Font = Enum.Font.GothamMedium
    statusTxt.Text = "офлайн"; statusTxt.TextSize = 12; statusTxt.TextColor3 = C.textMut
    statusTxt.TextXAlignment = Enum.TextXAlignment.Left; statusTxt.ZIndex = 4; statusTxt.Parent = header

    local minBtn = Instance.new("TextButton")
    minBtn.Size = UDim2.new(0, 30, 0, 30); minBtn.Position = UDim2.new(1, -70, 0.5, -15)
    minBtn.Text = ""; minBtn.ZIndex = 4; minBtn.Parent = header
    round(minBtn, 8); hoverFade(minBtn)
    local minLine = Instance.new("Frame")
    minLine.AnchorPoint = Vector2.new(0.5,0.5); minLine.Position = UDim2.new(0.5,0,0.5,0)
    minLine.Size = UDim2.new(0,12,0,2); minLine.BackgroundColor3 = C.textMut
    minLine.BorderSizePixel = 0; minLine.ZIndex = 5; minLine.Parent = minBtn; round(minLine,1)

    local closeBtn = Instance.new("TextButton")
    closeBtn.Size = UDim2.new(0, 30, 0, 30); closeBtn.Position = UDim2.new(1, -36, 0.5, -15)
    closeBtn.Text = ""; closeBtn.ZIndex = 4; closeBtn.Parent = header
    round(closeBtn, 8); hoverFade(closeBtn)
    for _, rot in ipairs({45, -45}) do
        local ln = Instance.new("Frame")
        ln.AnchorPoint = Vector2.new(0.5,0.5); ln.Position = UDim2.new(0.5,0,0.5,0)
        ln.Size = UDim2.new(0,13,0,2); ln.BackgroundColor3 = C.textMut
        ln.BorderSizePixel = 0; ln.Rotation = rot; ln.ZIndex = 5; ln.Parent = closeBtn; round(ln,1)
    end

    -- лента
    local scroll = Instance.new("ScrollingFrame")
    scroll.Position = UDim2.new(0, 8, 0, 56); scroll.Size = UDim2.new(1, -16, 1, -112)
    scroll.BackgroundTransparency = 1; scroll.BorderSizePixel = 0
    scroll.ScrollBarThickness = 4; scroll.ScrollBarImageColor3 = C.blue
    scroll.CanvasSize = UDim2.new(0,0,0,0); scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
    scroll.ZIndex = 3; scroll.Parent = chatView
    pad(scroll, 6)
    local feed = Instance.new("UIListLayout"); feed.Padding = UDim.new(0, 10)
    feed.SortOrder = Enum.SortOrder.LayoutOrder; feed.Parent = scroll

    -- ввод
    local inputBar = Instance.new("Frame")
    inputBar.Position = UDim2.new(0, 12, 1, -50); inputBar.Size = UDim2.new(1, -24, 0, 40)
    inputBar.BackgroundTransparency = 1; inputBar.ZIndex = 3; inputBar.Parent = chatView
    local boxFrame = Instance.new("Frame")
    boxFrame.Size = UDim2.new(1, -98, 1, 0); boxFrame.BackgroundColor3 = C.surface
    boxFrame.BorderSizePixel = 0; boxFrame.ZIndex = 3; boxFrame.Parent = inputBar
    round(boxFrame, 10); stroke(boxFrame, C.stroke, 1)
    local box = Instance.new("TextBox")
    box.BackgroundTransparency = 1; box.Size = UDim2.new(1, 0, 1, 0)
    box.Font = Enum.Font.Gotham; box.PlaceholderText = "Сообщение..."
    box.PlaceholderColor3 = C.textMut; box.Text = ""; box.TextColor3 = C.textPri
    box.TextSize = 14; box.TextXAlignment = Enum.TextXAlignment.Left
    box.ClearTextOnFocus = false; box.ClipsDescendants = true; box.ZIndex = 4; box.Parent = boxFrame
    pad(box, 12)
    local sendBtn = Instance.new("TextButton")
    sendBtn.Size = UDim2.new(0, 88, 1, 0); sendBtn.Position = UDim2.new(1, -88, 0, 0)
    sendBtn.Font = Enum.Font.GothamBold; sendBtn.Text = "Отправить"; sendBtn.TextSize = 14
    sendBtn.TextColor3 = Color3.new(1,1,1); sendBtn.ZIndex = 3; sendBtn.Parent = inputBar
    round(sendBtn, 10); hoverColor(sendBtn, C.blue, C.blueHi)
    glow(sendBtn, C.blue, 0.55, 16, 2)

    -- ============ РЕНДЕР СООБЩЕНИЙ ============
    local function nameColor(name)
        local h = 0; for i=1,#name do h=(h*31+string.byte(name,i))%360 end
        return Color3.fromHSV(h/360, 0.5, 0.95)
    end
    local function firstChar(s)
        if utf8 and utf8.offset then local e = utf8.offset(s,2); if e then return s:sub(1,e-1) end end
        return s:sub(1,1)
    end
    local function scrollDown()
        task.defer(function() scroll.CanvasPosition = Vector2.new(0, scroll.AbsoluteCanvasSize.Y) end)
    end

    local idCache = {}
    local function resolveAvatar(name, img, letter)
        local function apply(uid)
            if uid and img and img.Parent then
                img.Image = "rbxthumb://type=AvatarHeadShot&id="..uid.."&w=100&h=100"
                img.ImageTransparency = 0; if letter then letter.Visible = false end
            end
        end
        if idCache[name] ~= nil then if idCache[name] then apply(idCache[name]) end return end
        task.spawn(function()
            local uid
            if LocalPlayer and name == LocalPlayer.Name then uid = LocalPlayer.UserId
            else local okId,res = pcall(function() return Players:GetUserIdFromNameAsync(name) end); if okId then uid=res end end
            idCache[name] = uid or false; apply(uid)
        end)
    end

    local order = 0
    local function addChat(m)
        local name = tostring(m.player or "?")
        order += 1
        local row = Instance.new("Frame")
        row.BackgroundTransparency = 1; row.Size = UDim2.new(1, -4, 0, 0)
        row.AutomaticSize = Enum.AutomaticSize.Y; row.LayoutOrder = order; row.ZIndex = 3; row.Parent = scroll
        local rl = Instance.new("UIListLayout"); rl.FillDirection = Enum.FillDirection.Horizontal
        rl.VerticalAlignment = Enum.VerticalAlignment.Top; rl.Padding = UDim.new(0,10); rl.Parent = row

        local av = Instance.new("Frame")
        av.Size = UDim2.new(0,36,0,36); av.BackgroundColor3 = nameColor(name)
        av.BorderSizePixel = 0; av.LayoutOrder = 1; av.ZIndex = 3; av.Parent = row; circle(av)
        local letter = Instance.new("TextLabel")
        letter.BackgroundTransparency = 1; letter.Size = UDim2.new(1,0,1,0)
        letter.Font = Enum.Font.GothamBold; letter.Text = string.upper(firstChar(name))
        letter.TextSize = 16; letter.TextColor3 = Color3.new(1,1,1); letter.ZIndex = 4; letter.Parent = av
        local img = Instance.new("ImageLabel")
        img.BackgroundTransparency = 1; img.Size = UDim2.new(1,0,1,0)
        img.ImageTransparency = 1; img.ZIndex = 4; img.Parent = av; circle(img)
        resolveAvatar(name, img, letter)

        local content = Instance.new("Frame")
        content.BackgroundTransparency = 1; content.Size = UDim2.new(1, -46, 0, 0)
        content.AutomaticSize = Enum.AutomaticSize.Y; content.LayoutOrder = 2; content.ZIndex = 3; content.Parent = row
        local cl = Instance.new("UIListLayout"); cl.Padding = UDim.new(0,1); cl.SortOrder = Enum.SortOrder.LayoutOrder; cl.Parent = content

        local nm = Instance.new("TextLabel")
        nm.BackgroundTransparency = 1; nm.Size = UDim2.new(1,0,0,16); nm.Font = Enum.Font.GothamBold; nm.TextSize = 13
        local rc = nameColor(name)
        if m.role and m.role.color == "GOLD" then rc = Color3.fromRGB(255,215,0)
        elseif m.role and m.role.color == "RAINBOW" then rc = Color3.fromRGB(120,180,255) end
        nm.TextColor3 = rc
        nm.Text = name .. ((m.role and m.role.prefix) and ("  ·  "..m.role.prefix) or "")
        nm.TextXAlignment = Enum.TextXAlignment.Left; nm.LayoutOrder = 1; nm.ZIndex = 3; nm.Parent = content

        local txt = Instance.new("TextLabel")
        txt.BackgroundTransparency = 1; txt.Size = UDim2.new(1,0,0,0); txt.AutomaticSize = Enum.AutomaticSize.Y
        txt.Font = Enum.Font.Gotham; txt.TextSize = 14; txt.TextColor3 = C.textPri; txt.Text = tostring(m.msg or "")
        txt.TextWrapped = true; txt.TextXAlignment = Enum.TextXAlignment.Left
        txt.LayoutOrder = 2; txt.ZIndex = 3; txt.Parent = content
        scrollDown()
    end

    local function addBanner(text, col)
        order += 1
        local row = Instance.new("Frame")
        row.BackgroundColor3 = C.surface; row.BackgroundTransparency = 0.35
        row.Size = UDim2.new(1,-4,0,0); row.AutomaticSize = Enum.AutomaticSize.Y
        row.LayoutOrder = order; row.ZIndex = 3; row.Parent = scroll; round(row, 8); pad(row, 8)
        local l = Instance.new("TextLabel")
        l.BackgroundTransparency = 1; l.Size = UDim2.new(1,0,0,0); l.AutomaticSize = Enum.AutomaticSize.Y
        l.Font = Enum.Font.GothamMedium; l.TextSize = 13; l.TextColor3 = col or C.textMut
        l.Text = text; l.TextWrapped = true; l.TextXAlignment = Enum.TextXAlignment.Center; l.ZIndex = 3; l.Parent = row
        scrollDown()
    end

    local function setStatus(isOn, label)
        TweenService:Create(statusDot, TweenInfo.new(0.25), { BackgroundColor3 = isOn and C.online or C.offline }):Play()
        if label then statusTxt.Text = label end
    end

    -- ============ СОСТОЯНИЕ + API ============
    local token, connected, running, canSend = nil, false, true, true
    local roleInfo, seenIds = nil, {}

    local function apiRequest(method, path, body)
        if not hasHttp then return nil, -1 end
        local headers = { ["User-Agent"]="RussChatClient/1.0", ["Accept"]="application/json" }
        if token then headers["X-Auth-Token"] = token end
        if body then headers["Content-Type"] = "application/json" end
        local okReq, res = pcall(function()
            return httpRequest({ Url=CONFIG.SERVER_URL..path, Method=method, Headers=headers,
                Body = body and HttpService:JSONEncode(body) or nil })
        end)
        if not okReq or not res then return nil, 0 end
        local status = res.StatusCode or res.Status or 0
        local data; if res.Body and #res.Body>0 then pcall(function() data = HttpService:JSONDecode(res.Body) end) end
        return data, status
    end

    local function login()
        local data, status = apiRequest("POST", "/auth/login", {
            player = USERNAME, adminSecret = (CONFIG.ADMIN_SECRET ~= "" and CONFIG.ADMIN_SECRET) or nil })
        if status == 200 and data and data.token then
            token, roleInfo, connected = data.token, data.role, true; return true
        end
        connected = false
        if status == -1 then return false, "executor без HTTP" end
        if status == 403 then return false, (data and data.error) or "доступ запрещён" end
        if status == 0 then return false, "сервер недоступен" end
        return false, "ошибка входа ("..tostring(status)..")"
    end

    local function fetchMessages()
        local data, status = apiRequest("GET", "/chat")
        if status == 401 then if login() then return fetchMessages() end return end
        if status == 200 and type(data) == "table" then
            for _, m in ipairs(data) do
                if m.id and not seenIds[m.id] then seenIds[m.id]=true; addChat(m) end
            end
        end
    end

    local function sendMessage(text)
        if not connected then addChat({ player=USERNAME, msg=text, role=roleInfo }); return end
        if not canSend then addBanner("Подожди пару секунд", C.warn); return end
        canSend = false; task.delay(3, function() canSend = true end)
        local data, status = apiRequest("POST", "/chat", { message = text })
        if status == 401 then if login() then sendMessage(text) end
        elseif status == 429 then addBanner("Слишком часто — подожди", C.warn)
        elseif status == 403 then addBanner((data and data.error) or "бан/мут", C.offline)
        elseif status == 400 then addBanner((data and data.error) or "сообщение отклонено", C.warn)
        elseif status ~= 200 then addBanner("ошибка отправки ("..tostring(status)..")", C.offline) end
    end

    -- ============ КНОПКИ ============
    local function doSend()
        local t = box.Text
        if not t or #t:gsub("%s","")==0 then return end
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
        TweenService:Create(holder, TweenInfo.new(0.2), { Size = UDim2.new(0,520,0, minimized and 48 or 380) }):Play()
        scroll.Visible = not minimized; inputBar.Visible = not minimized
    end)
    do
        local dragging, dragStart, startPos
        local function bind(bar)
            bar.InputBegan:Connect(function(i)
                if i.UserInputType==Enum.UserInputType.MouseButton1 or i.UserInputType==Enum.UserInputType.Touch then
                    dragging=true; dragStart=i.Position; startPos=holder.Position
                    i.Changed:Connect(function() if i.UserInputState==Enum.UserInputState.End then dragging=false end end)
                end
            end)
        end
        bind(header); bind(loader)
        UserInput.InputChanged:Connect(function(i)
            if dragging and (i.UserInputType==Enum.UserInputType.MouseMovement or i.UserInputType==Enum.UserInputType.Touch) then
                local d = i.Position - dragStart
                holder.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset+d.X, startPos.Y.Scale, startPos.Y.Offset+d.Y)
            end
        end)
    end

    -- ============ ЗАПУСК ============
    hScale.Scale = 0.9
    TweenService:Create(hScale, TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()

    local spinning = true
    task.spawn(function()
        while spinning do spGrad.Rotation = (spGrad.Rotation + 7) % 360; task.wait(0.03) end
    end)

    task.spawn(function()
        TweenService:Create(fill, TweenInfo.new(1.3, Enum.EasingStyle.Quad), { Size = UDim2.new(1,0,1,0) }):Play()

        local okLogin, err = false, "офлайн"
        if hasHttp then okLogin, err = login() else err = "executor без HTTP" end

        if okLogin then statusBig.Text = "Ready" else statusBig.Text = tostring(err) end
        task.wait(0.7)
        spinning = false

        -- переход в чат
        loader.Visible = false
        chatView.Visible = true
        TweenService:Create(hScale, TweenInfo.new(0.18), { Scale = 1.0 }):Play()

        if okLogin then
            setStatus(true, "онлайн"..((roleInfo and roleInfo.prefix) and (" · "..roleInfo.prefix) or ""))
            addBanner("Подключено. Приятного общения!", C.online)
            while running do pcall(fetchMessages); task.wait(math.max(1.5, CONFIG.POLL_INTERVAL)) end
        else
            setStatus(false, "офлайн")
            addBanner(tostring(err).." — можешь писать, видно локально", C.offline)
        end
    end)
end)

if not ok then notify("RussChat: ошибка", tostring(buildErr)) end
