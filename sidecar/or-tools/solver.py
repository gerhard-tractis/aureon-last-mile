"""
OR-Tools CP-SAT VRPTW sidecar — FastAPI app + solver.

Node index layout:
  [0 .. N-1]       — order locations
  [N .. N+V-1]     — driver start depots
  [N+V .. N+2V-1]  — driver end depots
"""
import time as time_mod

from fastapi import FastAPI
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from distance import Coords, build_distance_matrix
from models import (
    Constraints,
    Driver,
    Order,
    Route,
    SolveRequest,
    SolveResponse,
    Stop,
    UnassignedOrder,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DIST_SCALE = 100           # km → integer (centikm)
WEIGHT_SCALE = 10          # kg → integer (100 g units)
VOLUME_SCALE = 1000        # m³ → integer (litres)
SPEED_KM_PER_MIN = 40 / 60  # average urban speed

app = FastAPI(title="Aureon OR-Tools Sidecar")


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def _hhmm_to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _min_to_hhmm(minutes: int) -> str:
    minutes = max(0, int(minutes))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


# ---------------------------------------------------------------------------
# Drop reason inference (heuristic, called post-solve for dropped orders)
# ---------------------------------------------------------------------------

def _drop_reason(order: Order, drivers: list[Driver]) -> str:
    # Capacity check — any single driver must be able to carry the order
    if not any(
        d.max_weight_kg >= order.weight_kg and d.max_volume_m3 >= order.volume_m3
        for d in drivers
    ):
        return "capacity"

    # Time window vs shift overlap check
    tw_start = _hhmm_to_min(order.time_window_start)
    tw_end = _hhmm_to_min(order.time_window_end)
    time_overlap = any(
        _hhmm_to_min(d.shift_start) <= tw_end and _hhmm_to_min(d.shift_end) >= tw_start
        for d in drivers
    )
    if not time_overlap:
        return "time_window"

    return "no_feasible_driver"


# ---------------------------------------------------------------------------
# Solver
# ---------------------------------------------------------------------------

def solve(request: SolveRequest) -> SolveResponse:  # noqa: C901  (acceptable complexity)
    orders: list[Order] = request.orders
    drivers: list[Driver] = request.drivers
    constraints: Constraints = request.constraints
    N = len(orders)
    V = len(drivers)

    # ---- Edge cases --------------------------------------------------------
    if V == 0:
        return SolveResponse(
            status="infeasible" if N > 0 else "optimal",
            solve_time_seconds=0.0,
            objective_value=0,
            routes=[],
            unassigned_orders=[
                UnassignedOrder(order_id=o.id, reason="no_feasible_driver") for o in orders
            ],
            warnings=[],
        )

    if N == 0:
        return SolveResponse(
            status="optimal",
            solve_time_seconds=0.0,
            objective_value=0,
            routes=[],
            unassigned_orders=[],
            warnings=[],
        )

    # ---- Build coordinate list & distance/time matrices --------------------
    coords: list[Coords] = [Coords(o.lat, o.lng) for o in orders]
    for d in drivers:
        coords.append(Coords(d.start_lat, d.start_lng))
    for d in drivers:
        coords.append(Coords(d.end_lat, d.end_lng))

    dist_km = build_distance_matrix(coords)  # float NxN
    dist_int = [[int(v * DIST_SCALE) for v in row] for row in dist_km]
    time_int = [[int(v / SPEED_KM_PER_MIN) for v in row] for row in dist_km]

    starts = [N + i for i in range(V)]
    ends = [N + V + i for i in range(V)]

    # ---- OR-Tools routing model --------------------------------------------
    manager = pywrapcp.RoutingIndexManager(N + 2 * V, V, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    # Arc cost: total distance
    def _dist_cb(from_idx, to_idx):
        return dist_int[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    dist_cb_idx = routing.RegisterTransitCallback(_dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(dist_cb_idx)

    # Time dimension (travel time + service time at from-node)
    def _time_cb(from_idx, to_idx):
        fn = manager.IndexToNode(from_idx)
        tn = manager.IndexToNode(to_idx)
        service = orders[fn].service_time_minutes if fn < N else 0
        return time_int[fn][tn] + service

    time_cb_idx = routing.RegisterTransitCallback(_time_cb)

    MAX_TIME = 24 * 60
    routing.AddDimension(
        time_cb_idx,
        MAX_TIME,   # max waiting (slack)
        MAX_TIME,   # max cumul
        False,      # do NOT fix start cumul to zero — vehicles start at shift time
        "Time",
    )
    time_dim = routing.GetDimensionOrDie("Time")

    for idx, order in enumerate(orders):
        tw_s = _hhmm_to_min(order.time_window_start)
        tw_e = _hhmm_to_min(order.time_window_end)
        ri = manager.NodeToIndex(idx)
        time_dim.CumulVar(ri).SetRange(tw_s, tw_e)

    for v, driver in enumerate(drivers):
        ss = _hhmm_to_min(driver.shift_start)
        se = _hhmm_to_min(driver.shift_end)
        time_dim.CumulVar(routing.Start(v)).SetRange(ss, se)
        time_dim.CumulVar(routing.End(v)).SetRange(0, se)
        routing.AddVariableMinimizedByFinalizer(time_dim.CumulVar(routing.End(v)))

    # Weight capacity
    def _weight_cb(idx):
        n = manager.IndexToNode(idx)
        return int(orders[n].weight_kg * WEIGHT_SCALE) if n < N else 0

    routing.AddDimensionWithVehicleCapacity(
        routing.RegisterUnaryTransitCallback(_weight_cb),
        0,
        [int(d.max_weight_kg * WEIGHT_SCALE) for d in drivers],
        True,
        "Weight",
    )

    # Volume capacity
    def _volume_cb(idx):
        n = manager.IndexToNode(idx)
        return int(orders[n].volume_m3 * VOLUME_SCALE) if n < N else 0

    routing.AddDimensionWithVehicleCapacity(
        routing.RegisterUnaryTransitCallback(_volume_cb),
        0,
        [int(d.max_volume_m3 * VOLUME_SCALE) for d in drivers],
        True,
        "Volume",
    )

    # Stop count capacity
    def _stop_cb(idx):
        return 1 if manager.IndexToNode(idx) < N else 0

    routing.AddDimensionWithVehicleCapacity(
        routing.RegisterUnaryTransitCallback(_stop_cb),
        0,
        [d.max_stops for d in drivers],
        True,
        "Stops",
    )

    # Drop penalties (disjunctions per order)
    if constraints.allow_drops:
        _priority_mult = {"urgent": 10, "alert": 3, "ok": 1}
        for idx, order in enumerate(orders):
            penalty = constraints.drop_penalty * _priority_mult.get(order.priority, 1)
            routing.AddDisjunction([manager.NodeToIndex(idx)], penalty)

    # Route balancing (optional)
    if constraints.balance_routes:
        stop_dim = routing.GetDimensionOrDie("Stops")
        stop_dim.SetGlobalSpanCostCoefficient(1000)

    # ---- Search parameters -------------------------------------------------
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = constraints.max_solve_time_seconds

    t0 = time_mod.time()
    solution = routing.SolveWithParameters(params)
    solve_time = round(time_mod.time() - t0, 3)

    # ---- No solution found -------------------------------------------------
    if solution is None:
        unassigned = [
            UnassignedOrder(order_id=o.id, reason=_drop_reason(o, drivers))
            for o in orders
        ]
        return SolveResponse(
            status="infeasible",
            solve_time_seconds=solve_time,
            objective_value=0,
            routes=[],
            unassigned_orders=unassigned,
            warnings=[],
        )

    # ---- Extract routes from solution --------------------------------------
    routes: list[Route] = []
    assigned_ids: set[str] = set()

    for v in range(V):
        driver = drivers[v]
        stops: list[Stop] = []
        prev_node = starts[v]
        sequence = 0

        idx = routing.Start(v)
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            if node < N:  # order node
                sequence += 1
                order = orders[node]
                arrival_min = solution.Min(time_dim.CumulVar(idx))
                departure_min = arrival_min + order.service_time_minutes
                dist_from_prev = round(dist_km[prev_node][node], 3)

                stops.append(
                    Stop(
                        order_id=order.id,
                        sequence=sequence,
                        arrival_time=_min_to_hhmm(arrival_min),
                        departure_time=_min_to_hhmm(departure_min),
                        distance_from_prev_km=dist_from_prev,
                    )
                )
                assigned_ids.add(order.id)
                prev_node = node

            idx = solution.Value(routing.NextVar(idx))

        if not stops:
            continue

        # Total distance including last stop → end depot
        total_dist = sum(s.distance_from_prev_km for s in stops) + round(
            dist_km[prev_node][ends[v]], 3
        )
        start_min = solution.Min(time_dim.CumulVar(routing.Start(v)))
        end_min = solution.Min(time_dim.CumulVar(routing.End(v)))
        total_time = max(0, end_min - start_min)

        routes.append(
            Route(
                driver_id=driver.id,
                stops=stops,
                total_distance_km=round(total_dist, 3),
                total_time_minutes=total_time,
            )
        )

    # ---- Unassigned orders -------------------------------------------------
    unassigned_orders = [
        UnassignedOrder(order_id=o.id, reason=_drop_reason(o, drivers))
        for o in orders
        if o.id not in assigned_ids
    ]

    # ---- Status mapping ----------------------------------------------------
    routing_status = routing.status()
    # 0=NOT_SOLVED, 1=SUCCESS, 2=PARTIAL_SUCCESS(time limit), 3=FAIL, 4=FAIL_TIMEOUT
    if routing_status == 2:
        status = "timeout"
    else:
        status = "feasible"

    return SolveResponse(
        status=status,
        solve_time_seconds=solve_time,
        objective_value=solution.ObjectiveValue(),
        routes=routes,
        unassigned_orders=unassigned_orders,
        warnings=[],
    )


# ---------------------------------------------------------------------------
# FastAPI endpoints
# ---------------------------------------------------------------------------

@app.get("/api/v1/health")
def health():
    import ortools
    version = getattr(ortools, "__version__", "9.x")
    return {"status": "ok", "solver_version": version}


@app.post("/api/v1/optimize", response_model=SolveResponse)
def optimize(request: SolveRequest) -> SolveResponse:
    return solve(request)
