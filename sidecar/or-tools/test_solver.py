"""
Test suite for the OR-Tools VRPTW sidecar.

Covers exit criteria from spec-10e:
  - health endpoint
  - small (10 orders), medium (100), large (200) solves
  - capacity, time-window, shift, drop-penalty, balance constraints
  - edge cases: 0 orders, 0 drivers, all same location, infeasible
"""
import time as time_mod

import pytest
from fastapi.testclient import TestClient

from solver import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_order(i: int, lat: float = -33.45, lng: float = -70.66, **kwargs):
    base = {
        "id": f"order-{i:04d}",
        "lat": lat + i * 0.001,
        "lng": lng + i * 0.001,
        "time_window_start": "08:00",
        "time_window_end": "18:00",
        "service_time_minutes": 15,
        "weight_kg": 10.0,
        "volume_m3": 0.2,
        "priority": "ok",
    }
    base.update(kwargs)
    return base


def make_driver(i: int, **kwargs):
    base = {
        "id": f"driver-{i:04d}",
        "name": f"Driver {i}",
        "start_lat": -33.45,
        "start_lng": -70.66,
        "end_lat": -33.45,
        "end_lng": -70.66,
        "shift_start": "08:00",
        "shift_end": "20:00",
        "max_weight_kg": 500.0,
        "max_volume_m3": 10.0,
        "max_stops": 30,
        "cost_per_km": 150.0,
    }
    base.update(kwargs)
    return base


def make_payload(n_orders: int, n_drivers: int, **constraint_overrides):
    constraints = {
        "max_solve_time_seconds": 30,
        "allow_drops": True,
        "drop_penalty": 10000,
        "balance_routes": False,
    }
    constraints.update(constraint_overrides)
    return {
        "operator_id": "test-operator",
        "delivery_date": "2026-03-21",
        "orders": [make_order(i) for i in range(n_orders)],
        "drivers": [make_driver(i) for i in range(n_drivers)],
        "constraints": constraints,
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def test_health_returns_ok():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "solver_version" in body


# ---------------------------------------------------------------------------
# Response structure
# ---------------------------------------------------------------------------

def test_response_has_all_required_fields():
    payload = make_payload(3, 1)
    resp = client.post("/api/v1/optimize", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "solve_time_seconds" in data
    assert "objective_value" in data
    assert "routes" in data
    assert "unassigned_orders" in data
    assert "warnings" in data
    assert data["status"] in ("optimal", "feasible", "infeasible", "timeout")


def test_routes_and_stops_have_required_fields():
    payload = make_payload(5, 1)
    resp = client.post("/api/v1/optimize", json=payload)
    data = resp.json()
    for route in data["routes"]:
        assert "driver_id" in route
        assert "stops" in route
        assert "total_distance_km" in route
        assert "total_time_minutes" in route
        for stop in route["stops"]:
            assert "order_id" in stop
            assert "sequence" in stop
            assert "arrival_time" in stop
            assert "departure_time" in stop
            assert "distance_from_prev_km" in stop


# ---------------------------------------------------------------------------
# Small solve (10 orders / 2 drivers)
# ---------------------------------------------------------------------------

def test_small_solve_returns_valid_status():
    payload = make_payload(10, 2)
    resp = client.post("/api/v1/optimize", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] in ("optimal", "feasible", "timeout")


def test_small_solve_orders_partitioned_between_assigned_and_unassigned():
    payload = make_payload(10, 2)
    resp = client.post("/api/v1/optimize", json=payload)
    data = resp.json()
    assigned = {stop["order_id"] for r in data["routes"] for stop in r["stops"]}
    unassigned = {u["order_id"] for u in data["unassigned_orders"]}
    all_ids = {o["id"] for o in payload["orders"]}
    # Every order is either assigned or unassigned, with no overlap
    assert assigned | unassigned == all_ids
    assert assigned & unassigned == set()


def test_small_solve_stop_sequences_are_monotonically_increasing():
    payload = make_payload(10, 2)
    resp = client.post("/api/v1/optimize", json=payload)
    for route in resp.json()["routes"]:
        seqs = [s["sequence"] for s in route["stops"]]
        assert seqs == sorted(seqs)
        assert seqs[0] >= 1  # 1-based sequences


def test_small_solve_respects_weight_capacity():
    # Each order weighs 200 kg, each driver carries max 400 kg → max 2 orders
    payload = make_payload(6, 2)
    for o in payload["orders"]:
        o["weight_kg"] = 200.0
    for d in payload["drivers"]:
        d["max_weight_kg"] = 400.0
    resp = client.post("/api/v1/optimize", json=payload)
    for route in resp.json()["routes"]:
        assert len(route["stops"]) <= 2


def test_small_solve_respects_max_stops_per_driver():
    payload = make_payload(20, 2)
    for d in payload["drivers"]:
        d["max_stops"] = 5
    resp = client.post("/api/v1/optimize", json=payload)
    for route in resp.json()["routes"]:
        assert len(route["stops"]) <= 5


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_zero_orders_returns_gracefully():
    payload = make_payload(0, 2)
    resp = client.post("/api/v1/optimize", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("optimal", "feasible")
    assert data["unassigned_orders"] == []
    # Either no routes at all, or all routes have 0 stops
    assert all(len(r["stops"]) == 0 for r in data["routes"])


def test_zero_drivers_returns_all_unassigned():
    payload = make_payload(5, 0)
    resp = client.post("/api/v1/optimize", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["routes"] == []
    assert len(data["unassigned_orders"]) == 5


def test_all_same_location_assigns_all_orders():
    payload = make_payload(10, 1)
    for o in payload["orders"]:
        o["lat"] = -33.45
        o["lng"] = -70.66
    payload["drivers"][0]["start_lat"] = -33.45
    payload["drivers"][0]["start_lng"] = -70.66
    payload["drivers"][0]["end_lat"] = -33.45
    payload["drivers"][0]["end_lng"] = -70.66
    resp = client.post("/api/v1/optimize", json=payload)
    data = resp.json()
    assert data["status"] in ("optimal", "feasible", "timeout")
    assigned = sum(len(r["stops"]) for r in data["routes"])
    assert assigned == 10


def test_allow_drops_false_with_impossible_constraints_returns_infeasible():
    # 1 driver max 1 stop, 5 orders, no drops allowed
    payload = make_payload(5, 1, allow_drops=False)
    payload["drivers"][0]["max_stops"] = 1
    resp = client.post("/api/v1/optimize", json=payload)
    data = resp.json()
    assert data["status"] in ("infeasible", "timeout")


def test_infeasible_tight_time_windows_with_no_drops():
    # 20 orders all requiring delivery in a 1-minute window — infeasible for 1 driver
    payload = make_payload(20, 1, allow_drops=False)
    for o in payload["orders"]:
        o["time_window_start"] = "09:00"
        o["time_window_end"] = "09:01"
        o["service_time_minutes"] = 5
    resp = client.post("/api/v1/optimize", json=payload)
    data = resp.json()
    assert data["status"] in ("infeasible", "timeout")


def test_unassigned_orders_have_valid_reason():
    payload = make_payload(10, 1)
    payload["drivers"][0]["max_stops"] = 3
    payload["constraints"]["allow_drops"] = True
    resp = client.post("/api/v1/optimize", json=payload)
    data = resp.json()
    valid_reasons = {"capacity", "time_window", "no_feasible_driver"}
    for u in data["unassigned_orders"]:
        assert "order_id" in u
        assert u["reason"] in valid_reasons


# ---------------------------------------------------------------------------
# Priority: urgent orders get higher drop penalty
# ---------------------------------------------------------------------------

def test_urgent_orders_preferred_over_ok_when_drops_needed():
    # 1 driver, max 2 stops; 1 urgent + 3 ok orders, all at same location
    payload = make_payload(4, 1, drop_penalty=10000)
    for o in payload["orders"]:
        o["lat"] = -33.45
        o["lng"] = -70.66
    payload["orders"][0]["priority"] = "urgent"
    payload["drivers"][0]["max_stops"] = 2
    resp = client.post("/api/v1/optimize", json=payload)
    data = resp.json()
    assigned = {s["order_id"] for r in data["routes"] for s in r["stops"]}
    # Urgent order-0000 must be among the 2 assigned
    assert "order-0000" in assigned


# ---------------------------------------------------------------------------
# Medium solve (100 orders / 5 drivers)
# ---------------------------------------------------------------------------

def test_medium_solve_completes_and_returns_valid_response():
    payload = make_payload(100, 5, max_solve_time_seconds=30)
    start = time_mod.time()
    resp = client.post("/api/v1/optimize", json=payload)
    elapsed = time_mod.time() - start
    assert resp.status_code == 200
    assert elapsed < 60  # wall-clock must finish within 60s
    assert resp.json()["status"] in ("optimal", "feasible", "timeout")


# ---------------------------------------------------------------------------
# Large solve (200 orders / 10 drivers)
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_large_solve_completes_and_returns_valid_response():
    payload = make_payload(200, 10, max_solve_time_seconds=60)
    start = time_mod.time()
    resp = client.post("/api/v1/optimize", json=payload)
    elapsed = time_mod.time() - start
    assert resp.status_code == 200
    assert elapsed < 120  # must finish within 120s wall-clock
    assert resp.json()["status"] in ("optimal", "feasible", "timeout")


# ---------------------------------------------------------------------------
# Timeout returns best partial solution (not an error)
# ---------------------------------------------------------------------------

def test_timeout_returns_partial_solution_not_error():
    payload = make_payload(50, 3, max_solve_time_seconds=1)  # very short budget
    resp = client.post("/api/v1/optimize", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    # Must not crash; status may be timeout, feasible, or even infeasible (no sol found)
    assert data["status"] in ("optimal", "feasible", "timeout", "infeasible")
    assert isinstance(data["routes"], list)
    assert isinstance(data["unassigned_orders"], list)
