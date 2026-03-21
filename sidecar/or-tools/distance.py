import math
from typing import NamedTuple


class Coords(NamedTuple):
    lat: float
    lng: float


def haversine_km(a: Coords, b: Coords) -> float:
    """Great-circle distance in km between two lat/lng points."""
    R = 6371.0
    lat1, lon1 = math.radians(a.lat), math.radians(a.lng)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lng)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(max(0.0, h)))


def build_distance_matrix(coords: list[Coords]) -> list[list[float]]:
    """Build a full NxN distance matrix (km) from a list of coordinates."""
    n = len(coords)
    return [[haversine_km(coords[i], coords[j]) for j in range(n)] for i in range(n)]
