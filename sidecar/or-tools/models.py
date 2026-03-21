from typing import Literal

from pydantic import BaseModel, Field


class Order(BaseModel):
    id: str
    lat: float
    lng: float
    time_window_start: str  # "HH:MM"
    time_window_end: str    # "HH:MM"
    service_time_minutes: int = 15
    weight_kg: float = 0.0
    volume_m3: float = 0.0
    priority: Literal["urgent", "alert", "ok"] = "ok"


class Driver(BaseModel):
    id: str
    name: str
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    shift_start: str  # "HH:MM"
    shift_end: str    # "HH:MM"
    max_weight_kg: float
    max_volume_m3: float
    max_stops: int
    cost_per_km: float = 0.0


class Constraints(BaseModel):
    max_solve_time_seconds: int = 60
    allow_drops: bool = True
    drop_penalty: int = 10000
    balance_routes: bool = False


class SolveRequest(BaseModel):
    operator_id: str
    delivery_date: str
    orders: list[Order]
    drivers: list[Driver]
    constraints: Constraints = Field(default_factory=Constraints)


class Stop(BaseModel):
    order_id: str
    sequence: int
    arrival_time: str
    departure_time: str
    distance_from_prev_km: float


class Route(BaseModel):
    driver_id: str
    stops: list[Stop]
    total_distance_km: float
    total_time_minutes: int


class UnassignedOrder(BaseModel):
    order_id: str
    reason: Literal["capacity", "time_window", "no_feasible_driver"]


class SolveResponse(BaseModel):
    status: Literal["optimal", "feasible", "infeasible", "timeout"]
    solve_time_seconds: float
    objective_value: int
    routes: list[Route]
    unassigned_orders: list[UnassignedOrder]
    warnings: list[str]
