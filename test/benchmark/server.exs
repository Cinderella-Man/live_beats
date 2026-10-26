# Local browser fixture: real application, endpoint, session signing and database.
Application.put_env(:live_beats, LiveBeatsWeb.Endpoint,
  Keyword.merge(Application.get_env(:live_beats, LiveBeatsWeb.Endpoint),
    server: true, check_origin: false, http: [ip: {127, 0, 0, 1}, port: 4002]))
{:ok, _} = Application.ensure_all_started(:live_beats)
Logger.configure(level: :warning)
Ecto.Adapters.SQL.Sandbox.mode(LiveBeats.Repo, :auto)
import Plug.Conn
alias LiveBeats.{Repo, Accounts.User, MediaLibrary.Song}
Repo.delete_all(Song)
Repo.delete_all(LiveBeats.Accounts.Identity)
Repo.delete_all(User)

uploads = Path.dirname(LiveBeats.MediaLibrary.local_filepath("fixture.wav"))
File.mkdir_p!(uploads)
# Two minutes of generated PCM audio, with no external content or codecs.
samples = :binary.copy(<<0::little-signed-16>>, 8_000 * 120)
size = byte_size(samples)
wav = <<"RIFF", (size + 36)::little-32, "WAVEfmt ", 16::little-32, 1::little-16,
  1::little-16, 8_000::little-32, 16_000::little-32, 2::little-16, 16::little-16,
  "data", size::little-32, samples::binary>>
{:ok, ip} = EctoNetwork.INET.cast("127.0.0.1")

cookie_for = fn user ->
  conn = Plug.Test.conn(:get, "/")
  |> Map.put(:secret_key_base, LiveBeatsWeb.Endpoint.config(:secret_key_base))
  |> Plug.Session.call(Plug.Session.init(store: :cookie, key: "_live_beats_key_v1", signing_salt: "9OALgV62"))
  |> fetch_session()
  |> LiveBeatsWeb.UserAuth.log_in_user(user)
  conn.resp_cookies["_live_beats_key_v1"].value
end

profiles = for n <- 1..6 do
  user = Repo.insert!(%User{username: "listener#{n}", email: "listener#{n}@example.test",
    name: "Local listener #{n}", profile_tagline: "Local songs", songs_count: 2,
    avatar_url: "/favicon.ico", external_homepage_url: "http://127.0.0.1:4002/"})
  songs = for {title, artist, index} <- [{"Morning Glass", "Lena North", 1}, {"Evening River", "Orion South", 2}] do
    filename = "fixture-#{n}-#{index}.wav"
    filepath = LiveBeats.MediaLibrary.local_filepath(filename)
    File.write!(filepath, wav)
    song = Repo.insert!(%Song{user_id: user.id, artist: artist, title: title, duration: 120,
      mp3_url: "http://127.0.0.1:4002/files/#{filename}", mp3_filename: filename,
      mp3_filepath: filepath, mp3_filesize: byte_size(wav), server_ip: ip, status: :stopped})
    %{id: song.id, title: title, artist: artist, filename: filename}
  end
  %{username: user.username, cookie: cookie_for.(user), songs: songs}
end
IO.puts("EAB_BROWSER_READY " <> Jason.encode!(%{profiles: profiles}))
Process.sleep(:infinity)
