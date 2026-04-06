# DispatchTrack Webhook Payloads

> Source: https://webhooks-lastmile.dispatchtrack.com/ (scraped 2026-03-06)
> Account: Transportes MUSAN (account_id: 797)

## Resource Types

DispatchTrack sends 4 resource types via webhook:

| Resource | Trigger | Relevance |
|----------|---------|-----------|
| `dispatch` | Status change (pending/success/rejected/partial) | **Primary** — delivery tracking |
| `route` | Route created/updated/started/ended | **Primary** — route tracking |
| `review` | Customer review submitted | Low — customer satisfaction |
| `dispatch_guide` | Guide (order) created in DT | Low — order creation event |

---

## 1. Dispatch Payload

Called when dispatch status changes. This is the most important resource for delivery tracking.

### Status Codes
| Code | Meaning | Our Enum |
|------|---------|----------|
| 1 | Pending | `pending` |
| 2 | Success | `delivered` |
| 3 | Rejected | `failed` |
| 4 | Partial | `partial` |

### Fields

| Field | Type | Description | Column Mapping |
|-------|------|-------------|----------------|
| `resource` | String | Always `"dispatch"` | — |
| `event` | String | `"update"` | — |
| `account_name` | String | `"Transportes MUSAN"` | — |
| `account_id` | Number | `797` | — |
| `identifier` | String | Guide identifier (= order_number) | `orders.order_number` lookup |
| `guide` | String | Same as identifier | — |
| `beecode` | String | Unique hash | `raw_data` |
| `dispatch_id` | Number | `630948765` | `dispatches.external_dispatch_id` |
| `route_id` | Number | `43600770` | `dispatches.route_id` → `routes.external_route_id` |
| `status` | Number | 1-4 (see above) | `dispatches.status` (mapped to enum) |
| `substatus` | String | e.g. `"Despacho adelantado"` | `dispatches.substatus` |
| `substatus_code` | String | e.g. `"07"` | `dispatches.substatus_code` |
| `truck_identifier` | String | Vehicle name e.g. `"ZALDUENDO"` | `fleet_vehicles` lookup |
| `truck_type` | String | e.g. `"Furgón"` | `fleet_vehicles.vehicle_type` |
| `position` | Number | Stop sequence on route | `dispatches.planned_sequence` |
| `estimated_at` | DateTime | Planned delivery time | `dispatches.estimated_at` |
| `arrived_at` | DateTime | Arrival timestamp | `dispatches.arrived_at` |
| `time_of_management` | DateTime | Completion timestamp | `dispatches.completed_at` |
| `management_latitude` | Number | GPS lat at management | `dispatches.latitude` |
| `management_longitude` | Number | GPS lon at management | `dispatches.longitude` |
| `is_pickup` | Boolean | Pickup movement | `dispatches.is_pickup` |
| `is_trunk` | Boolean | Trunk movement | `raw_data` |
| `locked` | Boolean | Guide locked | `raw_data` |
| `trigger` | String | `"Management"`, `"Disassociation"`, `"Notify"` | `raw_data` |
| `contact_name` | String | Recipient name | `raw_data` |
| `contact_phone` | String | Recipient phone | `raw_data` |
| `contact_email` | String | Recipient email | `raw_data` |
| `contact_address` | String | Delivery address | `raw_data` |
| `contact_identifier` | String | Contact ID | `raw_data` |
| `address_reference` | String | Address reference | `raw_data` |
| `mode` | Number | Unknown (observed: 0) | `raw_data` |
| `min_delivery_time` | DateTime | Min delivery window | `raw_data` |
| `max_delivery_time` | DateTime | Max delivery window | `raw_data` |
| `kpi_distance` | Float | KPI distance | `raw_data` |
| `real_distance` | Float | Actual distance | `raw_data` |
| `real_service_time` | ? | Service time | `raw_data` |
| `tags` | JSON[] | Custom field tags | `raw_data` |
| `items` | JSON[] | Delivery items with quantities | `raw_data` |
| `groups` | JSON[] | Groupings (e.g. retailer) | `raw_data` |
| `truck_groups` | JSON[] | Vehicle groupings | `raw_data` |
| `evaluation_answers` | JSON[] | Evaluation form answers | `raw_data` |
| `waypoint` | JSON | `{latitude, longitude}` managed location | `raw_data` |
| `place` | JSON | `{id, name}` current place | `raw_data` |
| `cod` | JSON[] | Cash on delivery | `raw_data` |
| `arrived_button` | JSON | Arrived button data | `raw_data` |
| `operation_milestones` | JSON[] | Operation milestones | `raw_data` |
| `histories` | JSON[] | Status change history | `raw_data` |

### Real Payload Sample (2026-03-06)

```json
{
  "resource": "dispatch",
  "event": "update",
  "account_name": "Transportes MUSAN",
  "account_id": 797,
  "guide": "2916967493",
  "identifier": "2916967493",
  "beecode": "fde4eb65ddc447758964e939",
  "mode": 0,
  "position": 1,
  "route_id": 43600770,
  "dispatch_id": 630948765,
  "truck_identifier": "ZALDUENDO",
  "truck_type": "Furgón",
  "status": 3,
  "estimated_at": "2026-03-06T16:17:03.000-03:00",
  "max_delivery_time": null,
  "min_delivery_time": null,
  "is_pickup": false,
  "is_trunk": false,
  "locked": false,
  "address_reference": null,
  "trigger": "Management",
  "substatus": "Despacho adelantado",
  "substatus_code": "07",
  "contact_name": "Edwin Fernando Lopez",
  "contact_phone": "569-93827057",
  "contact_identifier": null,
  "contact_email": "edwinfernando245@gmail.com",
  "contact_address": "Avenida Independencia 1050 205  INDEPENDENCIA",
  "tags": [],
  "items": [
    {
      "id": 924393781,
      "name": "CAMA N STYLE 4 PLUS 1.05X2.00 R RACHEL",
      "description": "CAMA N STYLE 4 PLUS 1.05X2.00 R RACHEL",
      "quantity": 1,
      "original_quantity": 1,
      "delivered_quantity": 0,
      "code": "1407181",
      "extras": []
    }
  ],
  "groups": [
    {
      "name": "EASY",
      "group_category": "CLIENTE",
      "group_category_id": 13043,
      "associated_at": "2026-03-06T09:51:58-03:00"
    }
  ],
  "arrived_at": "2026-03-06 16:09:46-0300",
  "evaluation_answers": [],
  "truck_groups": [],
  "kpi_distance": null,
  "real_distance": null,
  "time_of_management": "2026-03-06T16:09:46-03:00",
  "management_latitude": null,
  "management_longitude": null,
  "real_service_time": null
}
```

---

## 2. Route Payload

Called when a route is created, updated, started or ended.

### Fields

| Field | Type | Description | Column Mapping |
|-------|------|-------------|----------------|
| `resource` | String | Always `"route"` | — |
| `event` | String | Create/update/start/end | — |
| `route` | Number | Route unique ID | `routes.external_route_id` |
| `account_id` | Number | Account ID | — |
| `date` | Date | Dispatch date | `routes.route_date` |
| `truck` | String | Vehicle identifier | `fleet_vehicles` lookup |
| `truck_driver` | String | Driver name | `routes.driver_name` |
| `started` | Boolean | Route started? | derive `routes.status` |
| `started_at` | DateTime | Start time | `routes.start_time` |
| `ended` | Boolean | Route ended? | derive `routes.status` |
| `ended_at` | DateTime | End time | `routes.end_time` |
| `start_in_place` | Boolean | Started at dispatch center | `raw_data` |
| `kpi_distance` | Float | KPI distance | `routes.total_km` |
| `real_distance` | Float | Real distance | `raw_data` |
| `vehicle_type` | String | Vehicle type | `fleet_vehicles.vehicle_type` |
| `truck_driver_custom_fields` | JSON[] | Driver custom fields | `raw_data` |
| `cod` | JSON[] | Cash on delivery | `raw_data` |
| `start_form_answers` | JSON[] | Start form answers | `raw_data` |
| `end_form_answers` | JSON[] | End form answers | `raw_data` |

**Note:** No real route payload sample captured yet. Will be documented when observed.

---

## 3. Review Payload

Called when a customer submits a review. Low priority for current implementation.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `resource` | String | `"review"` |
| `event` | String | Event trigger |
| `account_name` | String | Account name |
| `account_id` | Number | Account ID |
| `general_score` | String | Rating 1-5 |
| `shipping_score` | String | Rating 1-5 |
| `service_score` | String | Rating 1-5 |
| `product_score` | String | Rating 1-5 |
| `comments` | String | Customer comment |
| `contact` | JSON | `{id, name, email, identifier, phone}` |
| `dispatch_guide` | JSON | `{id, code, beecode, service_time, min/max_delivery_time}` |

---

## 4. Dispatch Guide Payload

Called when a guide (order) is created in DispatchTrack. Minimal fields — just order metadata.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `resource` | String | `"dispatch_guide"` |
| `event` | String | `"create"` |
| `account_name` | String | Account name |
| `dispatch_guide` | JSON | Nested object (see below) |
| `dispatch_guide.guide` | String | Guide code |
| `dispatch_guide.beecode` | String | Unique hash |
| `dispatch_guide.identifier` | String | Order identifier |
| `dispatch_guide.account_id` | Number | Account ID |
| `dispatch_guide.contact_*` | String | Contact fields (name, phone, email, address, identifier) |
| `dispatch_guide.promised_date` | String | Promised delivery date |
| `dispatch_guide.min/max_delivery_time` | String | Delivery time window |
| `dispatch_guide.pincode_enabled` | Boolean | PIN code required |
| `dispatch_guide.number_of_retries` | Integer | Retry count |
| `dispatch_guide.address_reference` | String | Address reference |
| `items` | JSON[] | Order items |
| `tags` | JSON[] | Custom field tags |
| `groups` | JSON[] | Groupings |

### Real Payload Sample (2026-03-06)

```json
{
  "resource": "dispatch_guide",
  "event": "create",
  "account_name": "Transportes MUSAN",
  "dispatch_guide": {
    "guide": "2916971139",
    "beecode": "b7e66df85dd648355a951736",
    "identifier": "2916971139",
    "account_id": 797,
    "promised_date": null,
    "min_delivery_time": null,
    "max_delivery_time": null,
    "contact_name": null,
    "contact_phone": null,
    "contact_identifier": null,
    "contact_email": null,
    "contact_address": null,
    "address_reference": null
  },
  "tags": [],
  "items": [],
  "groups": []
}
```

---

## Schema Adjustments Based on Payload Analysis

Comparing real payloads + official docs against draft schema from story 3B.1:

### Dispatches — Add Columns
1. `substatus_code VARCHAR(10)` — programmatic substatus matching
2. `estimated_at TIMESTAMPTZ` — planned delivery time, needed for OTIF
3. `latitude DECIMAL(10,7)` — GPS at management point
4. `longitude DECIMAL(10,7)` — GPS at management point
5. `is_pickup BOOLEAN DEFAULT false` — distinguish pickup vs delivery

### Dispatches — Adjust
- `external_dispatch_id` confirmed as integer cast to VARCHAR — OK
- `failure_reason` → maps to `substatus` (rename for clarity? No — keep story schema, substatus is separate field)

### Routes — Confirmed
- `external_route_id` confirmed as integer cast to VARCHAR
- `driver_name` maps to `truck_driver`
- `start_time`/`end_time` map to `started_at`/`ended_at`
- `total_km` maps to `kpi_distance`
- Route status derived from `started`/`ended` booleans

### Fleet Vehicles — Adjust
- `truck_identifier` is the vehicle name (e.g. "ZALDUENDO"), not a plate number
- Rename `plate_number` concept: use `truck_identifier` as the lookup key
- `vehicle_type` maps to `truck_type` — confirmed

### Dispatch Guide — No new tables needed
- Maps to order creation — can be used for order lookup/reconciliation
- All data goes to `raw_data` on the dispatch or stored as-is
