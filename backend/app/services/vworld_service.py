import requests
import geopandas as gpd
from shapely.geometry import box
import json
from app.config import settings

# VWorld Data API Endpoint
VWORLD_DATA_API_URL = "http://api.vworld.kr/req/data"

def fetch_vworld_data(geomFilter: str):
    params = {
        "service": "data",
        "request": "GetFeature",
        "data": "lp_pa_cbnd_bubun",
        "key": settings.VWORLD_API_KEY,
        "domain": settings.VWORLD_DOMAIN,
        "geomFilter": geomFilter,
        "geometry": "true",
        "size": "1000",
        "crs": "EPSG:4326"
    }
    response = requests.get(VWORLD_DATA_API_URL, params=params)
    if response.status_code != 200:
        raise Exception(f"Failed to fetch data from VWorld: {response.text}")
    
    data = response.json()
    if "response" in data and data["response"]["status"] == "OK":
        return data["response"]["result"]["featureCollection"]
    else:
        # Sometimes there's no result or an error
        if "response" in data and data["response"]["status"] == "NOT_FOUND":
            return {"type": "FeatureCollection", "features": []}
        raise Exception(f"VWorld API Error: {data}")

def get_cadastre_by_bbox(minx: float, miny: float, maxx: float, maxy: float):
    # geomFilter format for BOX: BOX(minx,miny,maxx,maxy)
    geom_filter = f"BOX({minx},{miny},{maxx},{maxy})"
    geojson_data = fetch_vworld_data(geom_filter)
    
    # We can validate/process via GeoPandas if needed, but returning GeoJSON directly is often fine
    # Doing a quick conversion to verify crs
    if not geojson_data.get("features"):
        return geojson_data
        
    gdf = gpd.GeoDataFrame.from_features(geojson_data["features"])
    gdf.set_crs(epsg=4326, inplace=True)
    
    return json.loads(gdf.to_json())

def get_cadastre_by_point(lon: float, lat: float, buffer_meters: float = 300.0):
    # Approximate buffer in degrees (very rough estimation for Korea)
    # 1 degree lat is ~111km. 1 degree lon is ~90km at 37 lat.
    # We will use pyproj for a more accurate bounding box
    import pyproj
    from shapely.geometry import Point
    
    # Define projections
    wgs84 = pyproj.CRS("EPSG:4326")
    # Use UTM Zone 52N for Korea (approx) or Korea Central Belt EPSG:5181/5186
    # Let's use EPSG:5179 (Korea Unified Coordinate System) for buffering in meters
    epsg5179 = pyproj.CRS("EPSG:5179")
    
    transformer_to_m = pyproj.Transformer.from_crs(wgs84, epsg5179, always_xy=True)
    transformer_to_deg = pyproj.Transformer.from_crs(epsg5179, wgs84, always_xy=True)
    
    x, y = transformer_to_m.transform(lon, lat)
    point_m = Point(x, y)
    
    buffered_m = point_m.buffer(buffer_meters)
    minx_m, miny_m, maxx_m, maxy_m = buffered_m.bounds
    
    # Convert bounds back to WGS84
    minx, miny = transformer_to_deg.transform(minx_m, miny_m)
    maxx, maxy = transformer_to_deg.transform(maxx_m, maxy_m)
    
    return get_cadastre_by_bbox(minx, miny, maxx, maxy)

def geocode_address(address: str):
    url = "http://api.vworld.kr/req/address"
    params = {
        "service": "address",
        "request": "getcoord",
        "version": "2.0",
        "crs": "epsg:4326",
        "address": address,
        "refine": "true",
        "simple": "false",
        "format": "json",
        "type": "ROAD", # or PARCEL
        "key": settings.VWORLD_API_KEY
    }
    # Try ROAD first, if fails try PARCEL
    response = requests.get(url, params=params).json()
    if response.get("response", {}).get("status") == "OK":
        point = response["response"]["result"]["point"]
        return float(point["x"]), float(point["y"])
        
    # fallback to PARCEL
    params["type"] = "PARCEL"
    response = requests.get(url, params=params).json()
    if response.get("response", {}).get("status") == "OK":
        point = response["response"]["result"]["point"]
        return float(point["x"]), float(point["y"])
        
    return None

def get_cadastre_target_and_context_by_point(lon: float, lat: float, include_context: bool = False):
    geom_filter = f"POINT({lon} {lat})"
    
    try:
        geojson_data = fetch_vworld_data(geom_filter)
    except Exception as e:
        print(f"Failed to fetch cadastre for point {lon},{lat}: {e}")
        geojson_data = {}
        
    if not geojson_data.get("features"):
        return {"target": {"type": "FeatureCollection", "features": []}, "context": None}
        
    target_fc = {"type": "FeatureCollection", "features": geojson_data["features"]}
    context_fc = None
    
    if include_context:
        try:
            import geopandas as gpd
            gdf = gpd.GeoDataFrame.from_features(target_fc["features"])
            gdf.set_crs(epsg=4326, inplace=True)
            unioned_geom = gdf.geometry.unary_union
            
            import pyproj
            from shapely.ops import transform
            wgs84 = pyproj.CRS("EPSG:4326")
            epsg5179 = pyproj.CRS("EPSG:5179")
            transformer_to_m = pyproj.Transformer.from_crs(wgs84, epsg5179, always_xy=True)
            transformer_to_deg = pyproj.Transformer.from_crs(epsg5179, wgs84, always_xy=True)
            
            unioned_geom_m = transform(transformer_to_m.transform, unioned_geom)
            buffer_50m = unioned_geom_m.buffer(50.0)
            
            minx_m, miny_m, maxx_m, maxy_m = buffer_50m.bounds
            minx, miny = transformer_to_deg.transform(minx_m, miny_m)
            maxx, maxy = transformer_to_deg.transform(maxx_m, maxy_m)
            
            context_geojson = get_cadastre_by_bbox(minx, miny, maxx, maxy)
            if context_geojson and context_geojson.get("features"):
                target_pnus = set(f.get("properties", {}).get("pnu") for f in target_fc["features"])
                target_jibuns = set(f.get("properties", {}).get("jibun") for f in target_fc["features"])
                filtered_context = [f for f in context_geojson["features"] 
                                    if f.get("properties", {}).get("pnu") not in target_pnus 
                                    and f.get("properties", {}).get("jibun") not in target_jibuns]
                context_fc = {"type": "FeatureCollection", "features": filtered_context}
        except Exception as e:
            print(f"Failed to fetch context: {e}")
            
    return {"target": target_fc, "context": context_fc}

def get_cadastre_by_addresses(addresses: list, include_context: bool = False):
    features = []
    main_props = {}
    for address in addresses:
        address = address.strip()
        if not address: continue
        
        coords = geocode_address(address)
        if not coords:
            continue
            
        lon, lat = coords
        geom_filter = f"POINT({lon} {lat})"
        
        try:
            geojson_data = fetch_vworld_data(geom_filter)
            if geojson_data.get("features"):
                if not main_props:
                    main_props = geojson_data["features"][0].get("properties", {})
                features.extend(geojson_data["features"])
        except Exception as e:
            print(f"Failed to fetch cadastre for address {address}: {e}")
            
    if not features:
        return {"target": {"type": "FeatureCollection", "features": []}, "context": None}
        
    try:
        import geopandas as gpd
        gdf = gpd.GeoDataFrame.from_features(features)
        gdf.set_crs(epsg=4326, inplace=True)
        # Union all geometries
        unioned_geom = gdf.geometry.unary_union
        
        # Create a single feature from the unioned geometry
        from shapely.geometry import mapping
        unioned_geojson = mapping(unioned_geom)
        
        if len(addresses) > 1 and "jibun" in main_props:
            main_props["jibun"] = f"{main_props['jibun']} 외 {len(addresses)-1}필지"
            
        merged_feature = {
            "type": "Feature",
            "properties": main_props,
            "geometry": unioned_geojson
        }
        target_fc = {"type": "FeatureCollection", "features": [merged_feature]}

        context_fc = None
        if include_context:
            import pyproj
            wgs84 = pyproj.CRS("EPSG:4326")
            epsg5179 = pyproj.CRS("EPSG:5179")
            transformer_to_m = pyproj.Transformer.from_crs(wgs84, epsg5179, always_xy=True)
            transformer_to_deg = pyproj.Transformer.from_crs(epsg5179, wgs84, always_xy=True)
            
            # Reproject unioned geometry to meters to apply exact 50m buffer
            from shapely.ops import transform
            unioned_geom_m = transform(transformer_to_m.transform, unioned_geom)
            buffer_50m = unioned_geom_m.buffer(50.0)
            
            minx_m, miny_m, maxx_m, maxy_m = buffer_50m.bounds
            minx, miny = transformer_to_deg.transform(minx_m, miny_m)
            maxx, maxy = transformer_to_deg.transform(maxx_m, maxy_m)
            
            context_geojson = get_cadastre_by_bbox(minx, miny, maxx, maxy)
            if context_geojson and context_geojson.get("features"):
                # Filter out the target parcels from context
                target_pnus = set(f.get("properties", {}).get("pnu") for f in features if f.get("properties", {}).get("pnu"))
                target_jibuns = set(f.get("properties", {}).get("jibun") for f in features if f.get("properties", {}).get("jibun"))
                
                filtered_context = []
                for f in context_geojson["features"]:
                    props = f.get("properties", {})
                    if props.get("pnu") in target_pnus or props.get("jibun") in target_jibuns:
                        continue
                    filtered_context.append(f)
                    
                context_fc = {"type": "FeatureCollection", "features": filtered_context}
        
        return {"target": target_fc, "context": context_fc}
    except Exception as e:
        print(f"Failed to union geometries: {e}")
        return {"target": {"type": "FeatureCollection", "features": features}, "context": None}
