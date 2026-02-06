# Aureon Last Mile - UX Design Mockups

This folder contains interactive HTML mockups for the Aureon Last Mile platform.

## 🚀 Quick Start

### 📱 Pickup Verification (Operational Workflow)
```bash
start pickup-verification-mobile.html
```
**Try This:**
- 📱 **Tap Falabella card** to start verification
- 📱 **Click "Simular Escaneo"** to scan orders (watch success/error feedback!)
- 📱 **See progress bar** fill up (0/347 → complete)
- 📱 **Complete verification** to see summary stats

### 💰 Business Owner Dashboard (BI Metrics)
```bash
start business-owner-dashboard-desktop.html
```
**Try This:**
- 🖱️ **Click SLA hero metric** (94.2%) to drill down
- 🖱️ **Click metric cards** (FADR, Claims, Efficiency)
- 🖱️ **Sort table columns** (click headers)
- 🖱️ **Hover over charts** to see data points
- 🖱️ **Click failure reasons** bar to filter

### 📊 Operations Control Center (Real-time Monitoring)
```bash
start operations-control-center-desktop.html
```
**Try This:**
- 🖱️ **Hover over left sidebar** to see navigation labels
- 🖱️ **Click sidebar** to lock it expanded
- 🖱️ **Click pipeline cards** to filter orders
- 🖱️ **Watch countdown** update every minute (45 min → 44 min...)

### 📱 Operations Control Mobile (On-the-Go)
```bash
start operations-control-center-mobile.html
```
**Try This:**
- 📱 **Tap bottom tabs** to switch sections (Ops/Dashboard/Orders/Reports/More)
- 📱 **Watch header change** based on active tab
- 📱 **Tap status cards** at top (Urgentes/Alertas/OK)

---

## Files

### UX Design Directions

**ux-design-directions.html**
- Visual design direction reference
- Design inspiration and mood board
- Style guide exploration
- Created during initial UX planning phase

---

### Operational Workflows

**pickup-verification-mobile.html** ⭐ **NEW - Core Operational Workflow**
- **3-Screen Workflow:** Manifest selection → Scanning → Completion
- **Manifest List Screen:**
  - View today's pickups (Falabella 347 orders, Paris 189, Ripley 256)
  - Customer, order count, location, time, status
  - Tap to select and start verification
- **Scanning Screen:**
  - Real-time progress bar (0/347 → 347/347)
  - Large scan area with animation
  - Success feedback: Green flash + beep sound
  - Error feedback: Red overlay + triple beep
  - Offline indicator support
- **Completion Screen:**
  - Summary stats (orders verified, time, discrepancies, precision)
  - Generate digital receipt button
  - Return to manifest list
- **Designed for:** Pickup crews at retailer DCs (tablets/phones)
- **Pattern applies to:** Loading and Hub Reception workflows (same UX)

---

### Management Dashboards

**business-owner-dashboard-desktop.html** ⭐ **NEW - Business Intelligence**
- **Hero SLA Section:** 94.2% with color coding, trend (+2.3%), progress bar
- **Primary Metrics:** FADR (92.1%), Claims (150K CLP), Efficiency (42 min)
- **Customer Performance Table:** Sortable table with Falabella, Paris, Ripley, Lider
  - Columns: Cliente, Pedidos, SLA %, FADR %, Fallos, Valor, Actions
  - Color-coded SLA indicators (green/yellow/red)
  - Export CSV functionality
- **Failed Deliveries Analysis:**
  - Bar chart: Top 5 failure reasons with percentages
  - Line chart: Trend over time (Chart.js visualization)
  - Peak/lowest insights
- **Secondary Metrics:** Capacity (89.2%), Orders/Hour (38.2), Cost/Delivery (2,847 CLP), Satisfaction (4.6/5.0)
- **Actions Bar:** Export Report, Send to Retailers, Configure
- **Designed for:** Business owners and executives monitoring ROI

---

### Operations Control Center

1. **operations-control-center-desktop.html** ⭐ **Updated with Sidebar Navigation**
   - **Hybrid Navigation Approach:** Collapsible sidebar + full-screen operations view
   - **Collapsible Sidebar (70px → 250px):**
     - Hover to expand with labels
     - Click to lock expanded state
     - Navigate between: Ops Control, Business Dashboard, Inventory, Fleet, Team, Reports, Settings
     - Current section highlighted in Tractis gold
   - **Operations View:**
     - Pipeline overview with real-time order counts
     - Compact cards (all 8 visible without scrolling)
     - Detailed orders table with status indicators
     - Delivery promise dates and time windows
     - Interactive filters and search
   - **Designed for:** Operations Managers with multi-tasking needs
   - **Screen Size:** Optimized for 1440px+ displays

2. **operations-control-center-mobile.html** ⭐ **Updated with Bottom Tab Navigation**
   - **Bottom Tab Bar Navigation:**
     - 5 tabs: 📊 Ops, 💰 Dashboard, 📦 Orders, 📈 Reports, ⚙️ More
     - Thumb-optimized positioning (60px from bottom)
     - Active tab highlighted in Tractis gold
     - Badge indicator on Ops tab (3 urgent items)
     - Tap to switch sections (updates header title)
   - **Operations View:**
     - Displays as phone-sized viewport (428px max-width) even on desktop
     - Card-based layout optimized for touch
     - Status summary cards (Urgent/Alert/OK)
     - Essential order information at a glance
     - Swipe gestures and pull-to-refresh
   - **Designed for:** On-the-go operations management with multi-section access

## How to Use

### Viewing Mockups

1. **Open in Browser:**
   - Simply double-click any HTML file to open in your default browser
   - Or right-click → Open with → Choose your browser

2. **Best Viewing Experience:**
   - **Desktop mockup:** View on laptop/desktop with browser width ≥1280px
   - **Mobile mockup:** View on mobile device or use browser DevTools device mode
     - In Chrome: F12 → Toggle device toolbar (Ctrl+Shift+M)
     - Set to iPhone/Android dimensions (375px width)

### Interactive Features

**Desktop Version:**
- ✅ **Sidebar Navigation:**
  - Hover over sidebar to expand (70px → 250px)
  - Click sidebar to lock expanded state
  - Click navigation items to switch sections (currently logs to console)
  - Active section highlighted in Tractis gold
- ✅ **Pipeline & Orders:**
  - Click pipeline cards to filter orders by stage
  - Hover over table rows for highlight
  - Search input (logs to console)
  - Filter button interaction
  - Live countdown simulation (updates every minute)
  - Dismiss alert banner
  - Click order IDs to view details (logs to console)

**Mobile Version:**
- ✅ **Bottom Tab Navigation:**
  - Tap tabs to switch sections (Ops/Dashboard/Orders/Reports/More)
  - Active tab highlighted in gold with scale animation
  - Badge indicator on Ops tab shows urgent count
  - Header title updates based on active tab
- ✅ **Content Interactions:**
  - Tap status summary cards to filter
  - Search input
  - Pull down to refresh (works when scrolled to top)
  - Load more orders button
  - Live countdown simulation
  - Touch-optimized buttons with active states

## Navigation Approach

### Hybrid Navigation Pattern

The desktop mockup implements a **hybrid navigation approach** combining:

1. **Collapsible Sidebar (App-Wide Navigation)**
   - **Purpose:** Navigate between major application sections
   - **Behavior:**
     - Collapsed by default (70px width - icons only)
     - Expands on hover (250px - shows labels)
     - Click sidebar to lock expanded state
     - Minimal screen space usage when collapsed
   - **Sections:**
     - 📊 **Ops Control** (current) - Real-time operations monitoring
     - 💰 **Business Dashboard** - BI metrics and ROI analysis
     - 📦 **Inventory** - Warehouse and stock management
     - 🚚 **Fleet & Trucks** - Vehicle tracking
     - 👥 **Team** - Staff and driver management
     - 📈 **Reports** - Historical analysis and exports
     - ⚙️ **Settings** - Configuration

2. **Full-Width Operations View (Current Screen)**
   - **Purpose:** Maximum screen real estate for operational monitoring
   - **Benefit:** See all pipeline stages + orders simultaneously
   - **Ideal for:** Real-time monitoring and quick decision-making

3. **Card Drill-Down (Within Sections)**
   - Click pipeline cards → Filtered view with breadcrumbs
   - Click orders → Detail modal/full screen
   - Progressive disclosure for deeper exploration

### Design Rationale

**Desktop - Why Sidebar Navigation?**
- ✅ **Best of both worlds:** Persistent navigation + full-screen data view
- ✅ **Multi-tasking:** Quick access to Business Dashboard, Reports, Settings
- ✅ **Minimal clutter:** Sidebar collapses to 70px when not needed
- ✅ **Scalable:** Easy to add new sections as platform grows
- ✅ **Familiar:** Standard pattern that operations teams recognize

**Why NOT Pure Card Navigation?**
- ❌ Operations managers need to multi-task (check reports while monitoring)
- ❌ Too many clicks to switch contexts frequently
- ❌ Harder to maintain situational awareness across sections

**Mobile - Why Bottom Tab Bar?**
- ✅ **Thumb-optimized:** Easy reach on large phones (one-handed use)
- ✅ **Always visible:** No hidden menus, instant access
- ✅ **Industry standard:** iOS/Android users expect this pattern
- ✅ **Fast switching:** One tap to change sections
- ✅ **Visual clarity:** Icons + labels show available sections
- ✅ **Badge support:** Notifications visible without opening

**Why NOT Hamburger Menu?**
- ❌ Extra tap required to access navigation
- ❌ Less discoverable (users forget what's behind the menu)
- ❌ Harder to see where you are in app hierarchy
- ❌ Not optimized for frequent section switching

---

## Design Details

### Tractis Theme Integration
Both mockups use the official Tractis design tokens:
- **Gold Primary:** #e6c15c
- **Slate Colors:** #f8fafc to #0f172a
- **Typography:** Inter Variable font family
- **Status Colors:** Red (urgent), Yellow (alert), Green (ok), Gray (late)

### Key UX Features

**Desktop:**
- Pipeline visualization showing 8 stages
- Real-time order counts per stage
- Color-coded status indicators (🔴🟡🟢⚫)
- Delivery promise dates with smart relative display ("Hoy", "Mañana")
- Time window countdowns with urgency levels
- Sortable, filterable table
- Pagination for large datasets

**Mobile:**
- Simplified card-based interface
- Large touch targets (44px minimum)
- Essential information prioritized
- Quick actions per order
- Pull-to-refresh gesture
- Responsive typography optimized for small screens

## Technical Notes

- **Pure HTML/CSS/Vanilla JS:** No framework dependencies
- **Responsive:** Mobile mockup uses max-width: 768px
- **Accessibility:** Semantic HTML, keyboard navigation support
- **Performance:** Virtual scrolling recommended for production (>500 orders)
- **Real-time Updates:** Simulated with setInterval (production would use WebSocket)

## Future Enhancements

For production implementation:
- [ ] Connect to actual backend API
- [ ] Implement WebSocket for live updates
- [ ] Add filter panel slide-out
- [ ] Build order detail modal
- [ ] Implement reassignment workflow
- [ ] Add map view for live tracking
- [ ] Browser notifications for urgent orders
- [ ] Export functionality (PDF/CSV)
- [ ] Advanced analytics drill-downs

## Related Documentation

- **Full UX Specification:** `../ux-design-specification.md` (sections on Management Dashboards and Operations Control Center)
- **Business Owner Dashboard:** See UX spec for BI dashboard designs
- **Component Library:** Tractis theme JSON at `/docs/tractis-theme.json`

## Changelog

### 2026-02-05
- Initial creation of Operations Control Center mockups
- Desktop version: Full pipeline + table interface
- Mobile version: Card-based touch-optimized interface
- Added interactive features (countdown, filters, pull-to-refresh)

---

**Need Help?**
For questions about these mockups or to request additional designs, contact the UX team.

**Pro Tip:** Open browser DevTools console (F12) to see interaction logs when clicking/tapping elements.