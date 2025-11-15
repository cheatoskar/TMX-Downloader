import requests
import os
import urllib.parse
import re
import platform

def sanitize_filename(filename):
    return re.sub(r'[<>:"/\\|?*]', '_', filename)

def download_track(track_id, track_name, folder_name):
    download_url = f"https://tmnf.exchange/trackgbx/{track_id}"
    response = requests.get(download_url)
    if response.status_code == 200:
        sanitized_name = sanitize_filename(track_name)
        file_name = f"Track_{sanitized_name}.Challenge.Gbx"
        file_path = os.path.join(folder_name, file_name)
        with open(file_path, 'wb') as f:
            f.write(response.content)
        print(f"Downloaded track: {track_name} (ID: {track_id}) as {file_name}")
    else:
        print(f"Failed to download track ID: {track_id}")

def fetch_all_tracks(api_url):
    all_tracks = []
    current_last = 0

    while True:
        paginated_url = f"{api_url}&after={current_last}"
        try:
            response = requests.get(paginated_url, timeout=10)
            response.raise_for_status()
            tracks_results = response.json().get('Results', [])
            if not tracks_results:
                print("No more tracks available.")
                break
            all_tracks.extend(tracks_results)
            current_last = tracks_results[-1]['TrackId']
            print(f"Fetched {len(tracks_results)} tracks. Total so far: {len(all_tracks)}")
            if len(tracks_results) < 1000:
                print("Finished gathering all tracks.")
                break
        except requests.RequestException as e:
            print(f"Error fetching track list: {e}. Retrying...")
    return all_tracks

import urllib.parse
import re
from datetime import datetime

def convert_search_link_to_api(search_url):
    # Enum mappings (as previously defined)
    mood_map = {"sunrise": 0, "day": 1, "sunset": 2, "night": 3}
    difficulty_map = {"beginner": 1, "intermediate": 2, "expert": 3, "lunatic": 4}
    tags_map = {
        "normal": 0, "stunt": 1, "maze": 2, "offroad": 3, "laps": 4, "fullspeed": 5,
        "lol": 6, "tech": 7, "speedtech": 8, "rpg": 9, "pressforward": 10, 
        "trial": 11, "grass": 12
    }
    lbtype_map = {"standard": 0, "classic": 1, "nadeo": 2, "uncompetitive": 3, "beta": 4, "star": 5}
    routes_map = {"single": 0, "multiple": 1, "symmetrical": 2}
    primarytype_map = {"race": 0, "puzzle": 1, "platform": 2, "stunts": 3, "shortcut": 4, "laps": 5}
    
    # Collections for "in:" parameter, with their corresponding 0/1 values
    in_collections_map = {
        "screenshot": {"inscreenshot": 1},  # 1: HasScreenshot
        "latestauthor": {"inlatestauthor": 1},  # 1: Only newest track
        "latestawardedauthor": {"inlatestawardedauthor": 1},  # 1: Only most recently awarded track
        "supporter": {"insupporter": 1},  # 1: Only MX-Supporter tracks
        "hasrecord": {"inhasrecord": 1},  # 1: Track has at least one replay
        "unlimiter": {"inunlimiter": 1},  # 1: Track requires TMUnlimiter
    }
    
    # Collections for excluded "in:" parameter (prefixed with !), with their corresponding 0/1 values
    excluded_in_collections_map = {
        "screenshot": {"inscreenshot": 0},  # 0: Exclude HasScreenshot
        "latestauthor": {"inlatestauthor": 0},  # 0: Exclude newest track
        "latestawardedauthor": {"inlatestawardedauthor": 0},  # 0: Exclude most recently awarded track
        "supporter": {"insupporter": 0},  # 0: Exclude MX-Supporter tracks
        "hasrecord": {"inhasrecord": 0},  # 0: Exclude tracks with at least one replay
        "unlimiter": {"inunlimiter": 0},  # 0: Exclude TMUnlimiter tracks
    }
    
    # Parse the URL and extract the query parameters
    parsed_url = urllib.parse.urlparse(search_url)
    query_params = urllib.parse.parse_qs(parsed_url.query)
    
    # Get the raw query string
    raw_query = query_params.get('query', [''])[0]
    
    # Base API URL
    api_url = "https://tmnf.exchange/api/tracks?fields=TrackId,TrackName&count=1000"
    
    # Handle the author parameter
    if 'author:' in raw_query:
        # Extract the part after 'author:'
        author = raw_query.split('author:')[1].split()[0]
        api_url += f"&author={author}"  # Do not encode the '|'

    # Handle the type parameter
    if 'type:' in raw_query:
        # Extract the part after 'type:'
        track_type = raw_query.split('type:')[1].split()[0].strip().lower()
        if track_type in primarytype_map:
            api_url += f"&primarytype={primarytype_map[track_type]}"

    if 'routes:' in raw_query:
        route = raw_query.split('routes:')[1].split()[0].strip().lower()
        if route in routes_map:
            api_url += f"&route={routes_map[route]}"
    
    if '!hasrecord' in raw_query:
        api_url += "&inhasrecord=0"
    elif 'hasrecord' in raw_query:
        api_url += "&inhasrecord=1"

    if 'mood:' in raw_query:
        mood = raw_query.split('mood:')[1].split()[0].strip().lower()
        if mood in mood_map:
            api_url += f"&mood={mood_map[mood]}"

    if 'difficulty:' in raw_query:
        difficulty = raw_query.split('difficulty:')[1].split()[0].strip().lower()
        if difficulty in difficulty_map:
            api_url += f"&difficulty={difficulty_map[difficulty]}"

    if 'lbtype:' in raw_query:
        lbtype = raw_query.split('lbtype:')[1].split()[0].strip().lower()
        if lbtype in lbtype_map:
            api_url += f"&lbtype={lbtype_map[lbtype]}"
    
    if 'uploaded:' in raw_query:
        uploaded_range = raw_query.split('uploaded:')[1].split()[0].strip()
        try:
            if '...' in uploaded_range:
                start_date, end_date = uploaded_range.split("...")
                if start_date:
                    start_date = f"{start_date}T00:00:00"
                    api_url += f"&uploadedafter={start_date}"
                if end_date:
                    end_date = f"{end_date}T23:59:59"
                    api_url += f"&uploadedbefore={end_date}"
            else:
                start_date = f"{uploaded_range}T00:00:00"
                api_url += f"&uploadedafter={start_date}"
        except ValueError:
            print("Invalid uploaded range format.")

    if 'length:' in raw_query:
        length_range = raw_query.split('length:')[1].split()[0].strip()
        try:
            if '...' in length_range:
                start_time, end_time = length_range.split("...")
                if start_time:
                    start_ms = convert_to_milliseconds(start_time)
                    api_url += f"&authortimemin={start_ms}"
                if end_time:
                    end_ms = convert_to_milliseconds(end_time)
                    api_url += f"&authortimemax={end_ms}"
            else:
                start_ms = convert_to_milliseconds(length_range)
                api_url += f"&authortimemin={start_ms}"
        except ValueError:
            print("Invalid length range format.")
    
    # Handle "in:" parameter (collection filtering)
    if 'in:' in raw_query:
        in_collections = raw_query.split('in:')[1].split()[0].strip().lower().split(',')
        for collection in in_collections:
            if collection.startswith('!'):
                collection = collection[1:]  # Remove '!' for mapping
                if collection in excluded_in_collections_map:
                    for param, value in excluded_in_collections_map[collection].items():
                        api_url += f"&{param}={value}"
            elif collection in in_collections_map:
                for param, value in in_collections_map[collection].items():
                    api_url += f"&{param}={value}"
                    
    # Consolidated tags handling: supports both names and numbers, included/excluded
    if 'tags:' in raw_query:
        tags_str = raw_query.split('tags:')[1].split()[0].strip().lower()
        tags = [tag.strip() for tag in tags_str.split(',')]
        for tag in tags:
            if tag.startswith('!'):  # Excluded tag
                tag_clean = tag[1:].strip().lower()
                if tag_clean.isdigit():
                    api_url += f"&etag={tag_clean}"
                elif tag_clean in tags_map:
                    api_url += f"&etag={tags_map[tag_clean]}"
            else:  # Included tag
                tag_clean = tag.strip().lower()
                if tag_clean.isdigit():
                    api_url += f"&tag={tag_clean}"
                elif tag_clean in tags_map:
                    api_url += f"&tag={tags_map[tag_clean]}"

    def extract_track_name(raw_query):
        # List of known parameters that could appear in the query
        known_params = ['type:', 'tags:', 'mood:', 'difficulty:', 'lbtype:', 
                        'uploaded:', 'length:', 'in:', 'author:', 'routes:', 
                        'hasrecord', '!hasrecord']
        
        # Split the query into parts
        parts = raw_query.split()
        
        # Check if the query starts with a quoted name
        if raw_query.startswith('"'):
            try:
                # Extract everything between the first and second quote
                name = raw_query[raw_query.index('"') + 1:raw_query.index('"', 1)]
                return name
            except ValueError:
                pass  # Continue if quotes are mismatched or missing
        
        # Iterate through the parts to identify parameters and potential names
        name_parts = []
        for part in parts:
            # If the part starts with a known parameter, stop adding to name_parts
            if any(part.startswith(param) for param in known_params):
                break
            # Otherwise, treat it as part of the name
            name_parts.append(part)
        
        # If no name parts found, return None
        if not name_parts:
            return None
        
        # Join the name parts and strip any trailing special characters
        name = ' '.join(name_parts).strip('|:')
        return name if name else None
        
    track_name = extract_track_name(raw_query)
    if track_name:
        api_url += f"&name={urllib.parse.quote(track_name)}"
        
    return api_url


def convert_to_milliseconds(time_str):
    """Convert a time string (e.g., 0h0m30s, 15s, 1h0m15s) to milliseconds."""
    
    # Regular expression to match time formats
    time_pattern = re.compile(r'(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?')
    match = time_pattern.fullmatch(time_str.strip())
    
    if match:
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = int(match.group(3) or 0)
        
        # Convert to milliseconds
        return (hours * 3600 + minutes * 60 + seconds) * 1000
    else:
        raise ValueError(f"Invalid time format: {time_str}")

def download_trackpack(number):
    """Download all tracks in the specified trackpack, creating a subfolder named after the trackpack."""
    print(f"Fetching tracks for trackpack ID: {number}")
    
    # Fetch the trackpack name
    pack_info_url = f"https://tmnf.exchange/api/trackpacks?fields=PackName&id={number}"
    try:
        response = requests.get(pack_info_url)
        response.raise_for_status()
        pack_info = response.json()
        pack_name = pack_info.get('PackName', f"Trackpack_{number}")  # Fallback if PackName is missing
    except requests.RequestException as e:
        print(f"Failed to fetch trackpack info: {e}. Using default name.")
        pack_name = f"Trackpack_{number}"

    # Prompt for custom folder or use default location
    folder_name = input("Enter the folder where you want to save the trackpack (Press Enter for default): ").strip()
    if not folder_name:
        # Set default download directory based on OS
        default_base_folder = os.path.join(os.path.expanduser("~"), "Downloads", "TMX-Trackpacks")
        folder_name = default_base_folder

    # Ensure the main folder exists
    os.makedirs(folder_name, exist_ok=True)

    # Create a subfolder for this specific trackpack using the sanitized pack name
    trackpack_folder = os.path.join(folder_name, sanitize_filename(pack_name))
    os.makedirs(trackpack_folder, exist_ok=True)

    print(f"Tracks will be saved in: {trackpack_folder}")

    # Fetch all tracks in the trackpack
    api_url = f"https://tmnf.exchange/api/tracks?fields=TrackId,TrackName&count=1000&packid={number}"
    tracks = fetch_all_tracks(api_url)

    if not tracks:
        print(f"No tracks found in trackpack ID: {number}.")
        return

    # Download each track
    for track in tracks:
        track_id = track['TrackId']
        track_name = track.get('TrackName', f"Track_{track_id}")
        download_track(track_id, track_name, trackpack_folder)

def main():
    while True:
        # Start screen with information
        print("=" * 60)
        print("🎮 Welcome to TMNF-X Maps Downloader! 🎮")
        print("This tool makes it easy to download tracks from TMNF-X.")
        print("\n✨ Features:")
        print("  - Download TMNF-X tracks or trackpacks.")
        print("  - Specify custom search links for filtering.")
        print("  - Save tracks to a custom folder or the default folder: `/Downloads/TMX-Downloads`.")
        print("=" * 60)

        # Ask if the user needs help
        tmx_link = input("👉 Enter the TMNF-X search link, or Trackpack ID (type !help for assistance): ").strip()

        if tmx_link.isdigit():
            # User entered a number, call the new function
            download_trackpack(int(tmx_link))
            continue  # Restart the loop after handling the number

        if tmx_link == "!help":
            print("\n" + "=" * 60)
            print("❓ TMNF-X Maps Downloader Help ❓")
            print("\n📚 How to Use:")
            print("  1️⃣ Visit the TMNF-X website and create a search for the tracks you want.")
            print("  2️⃣ Copy the generated search link (or the Trackpack ID).")
            print("  3️⃣ Paste the link or ID into this program.")
            print("  4️⃣ Specify the number of tracks to download and the folder to save them.")
            print("  5️⃣ If no folder is specified, tracks are saved in the default `/Downloads/TMX-Downloads` folder.")
            
            print("\n💡 Parameters for Filtering:")
            print("  - author: Filters by track author.")
            print("  - type: Filters by track type (e.g., race, puzzle).")
            print("  - routes: Filters by route type (e.g., single, multiple).")
            print("  - hasrecord / !hasrecord: Filters by whether the track has a record.")
            print("  - tags: Filters by track tags (e.g., stunt, maze, offroad; or numbers like 7 for Tech).")
            print("  - mood: Filters by track mood (e.g., sunrise, sunset).")
            print("  - difficulty: Filters by difficulty level (e.g., beginner, expert).")
            print("  - lbtype: Filters by leaderboard type (e.g., standard, classic).")
            print("  - uploaded: Filters by upload date (single date or date range).")

            print("\n🔗 Example TMX Search Link:")
            print("   https://tmnf.exchange/tracksearch?query=author%3A+lolsport+difficulty%3A+lunatic+type%3A+race")
            print("   https://tmnf.exchange/tracksearch?query=tags%3A+7+in%3A+%21hasrecord")
            print("=" * 60 + "\n")
            continue  # Restart the loop after showing the help message

        if not tmx_link:
            tmx_link = "https://tmnf.exchange/api/tracks?fields=TrackId,TrackName&count=1000"
        
        # Convert TMX link to API URL
        api_url = convert_search_link_to_api(tmx_link)
        print(f"\nConverted API URL: {api_url}")
        
        # Fetch all tracks using pagination
        print("\nFetching all tracks...")
        tracks = fetch_all_tracks(api_url)
        print(f"Total tracks found: {len(tracks)}")
        
        if not tracks:
            print("No tracks found.")
            return
        
        # Ask user how many tracks to download
        download_choice = input("\nHow many tracks do you want to download? (number/all): ").strip().lower()
        if download_choice == "all":
            num_tracks_to_download = len(tracks)
        else:
            try:
                num_tracks_to_download = int(download_choice)
                num_tracks_to_download = min(num_tracks_to_download, len(tracks))
            except ValueError:
                print("Invalid input. Downloading all tracks.")
                num_tracks_to_download = len(tracks)
                
        # Ask user where to save the files
        folder_name = input("Enter the folder where you want to save the tracks (Pressing Enter will save them in the Standard Folder): ").strip()

        if not folder_name:
            # Get the user's Downloads directory
            if platform.system() == "Windows":
                folder_name = os.path.join(os.environ["USERPROFILE"], "Downloads", "TMX-Downloads")
            elif platform.system() == "Darwin":
                folder_name = os.path.join(os.path.expanduser("~"), "Downloads", "TMX-Downloads")
            else:
                folder_name = os.path.join(os.path.expanduser("~"), "Downloads", "TMX-Downloads")

        # Ensure folder exists
        os.makedirs(folder_name, exist_ok=True)
        print(f"Files will be saved in: {folder_name}")

        # Download tracks
        print(f"\nDownloading {num_tracks_to_download} tracks to folder: {folder_name}")
        for track in tracks[:num_tracks_to_download]:
            track_id = track['TrackId']
            track_name = track['TrackName']
            download_track(track_id, track_name, folder_name)
        break  

if __name__ == "__main__":
    main()