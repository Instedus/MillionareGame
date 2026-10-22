using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace MillionaireQuiz.Game;

public sealed class GameException : Exception
{
    public GameException(string message) : base(message) { }
}

public enum GamePhase { Setup, Playing, Finished }

// ---------- mutable server state ----------

public sealed class TeamState
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public int Score { get; set; }
    public bool FiftyUsed { get; set; }
    public bool PhoneUsed { get; set; }
    public bool AudienceUsed { get; set; }
    public bool TransferUsed { get; set; }
    public bool InsuranceUsed { get; set; }
    public bool DoubleUsed { get; set; }
    public int CorrectCount { get; set; }
    public int WrongCount { get; set; }
    public int ColorIndex { get; set; }
}

public sealed class UsedEntry
{
    public string QuestionId { get; set; } = "";
    public Guid? TeamId { get; set; }
    public string? TeamName { get; set; }
    public string? ChosenLetter { get; set; }
    public bool? WasCorrect { get; set; }
}

public sealed class TurnState
{
    public Guid TeamId { get; set; }
    public string QuestionId { get; set; } = "";
    public List<string> HiddenLetters { get; set; } = new();
    public string? ChosenLetter { get; set; }
    public bool? WasCorrect { get; set; }

    // ---------- new modifiers ----------
    public bool Transferred { get; set; }
    public bool Insured { get; set; }
    public bool Doubled { get; set; }
    public bool TimedOut { get; set; }

    [JsonIgnore]
    public bool HasAnswered => ChosenLetter != null || TimedOut;
}

public sealed class PersistedState
{
    public GamePhase Phase { get; set; } = GamePhase.Setup;
    public List<TeamState> Teams { get; set; } = new();
    public Guid? ActiveTeamId { get; set; }
    public List<UsedEntry> Used { get; set; } = new();
    public TurnState? Turn { get; set; }
    public List<Guid>? Winners { get; set; }
}

// ---------- DTOs sent to the client ----------
// NOTE: the correct answer / explanation are NEVER sent until the host submits an answer.

public sealed record OptionDto(string Letter, string Text);

public sealed record TeamDto(
    Guid Id, string Name, int Score,
    bool FiftyUsed, bool PhoneUsed, bool AudienceUsed,
    bool TransferUsed, bool InsuranceUsed, bool DoubleUsed,
    int CorrectCount, int WrongCount, int ColorIndex);

public sealed record CellDto(
    string QuestionId, string Number, bool Used, bool Current,
    string? Chosen, bool? Correct, string? TeamName);

public sealed record BoardCategoryDto(
    string Id, int Points, string Label, bool IsBackup,
    int Total, int Used, int Left, IReadOnlyList<CellDto> Cells);

public sealed record TurnQuestionDto(
    string Id, string Number, int Points, string CategoryId, string CategoryLabel,
    string Text, IReadOnlyList<OptionDto> Options, IReadOnlyList<string> Hidden);

public sealed record TurnAnsweredDto(
    string? Chosen, bool Correct, string CorrectLetter, string? Explanation,
    int Delta, int NewScore, bool TimedOut);

public sealed record TurnDto(
    Guid TeamId, string TeamName, TurnQuestionDto Question, TurnAnsweredDto? Answered,
    bool Transferred, bool Insured, bool Doubled);

public sealed record StateDto(
    string Phase,
    IReadOnlyList<TeamDto> Teams,
    Guid? ActiveTeamId,
    IReadOnlyList<BoardCategoryDto> Board,
    TurnDto? Turn,
    IReadOnlyList<Guid>? Winners,
    int QuestionsLeft,
    int QuestionsTotal);

public sealed record CatInfoDto(string Id, int Points, string Label, bool IsBackup, int Count);

public sealed record ConfigDto(
    string Title, string Subtitle, string Theme,
    int PhoneSeconds, int AudienceSeconds, int AnswerSeconds, int BackupPoints,
    IReadOnlyList<CatInfoDto> Categories, int TotalQuestions);

/// <summary>Result of one roulette spin: either a question or a flat score modifier.</summary>
public sealed record SpinOutcomeDto(
    string Kind, string Label, int Delta, int NewScore,
    Guid TeamId, string TeamName,
    string? QuestionId, string? QuestionNumber);

public sealed record SpinResultDto(StateDto State, SpinOutcomeDto Outcome);

// ---------- the store ----------

/// <summary>
/// Single source of truth for the running game. Thread-safe (single host, but be safe),
/// persisted to a JSON file after every mutation so a container restart doesn't kill the game.
/// </summary>
public sealed class GameStore
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly QuizBank _bank;
    private readonly GameOptions _opts;
    private readonly ILogger<GameStore> _logger;
    private readonly string _statePath;
    private readonly object _lock = new();
    private readonly Random _rnd = new();

    private GamePhase _phase = GamePhase.Setup;
    private readonly List<TeamState> _teams = new();
    private Guid? _activeTeamId;
    private readonly List<UsedEntry> _used = new();
    private TurnState? _turn;
    private List<Guid>? _winners;

    public GameStore(QuizBank bank, IOptions<GameOptions> opts, IHostEnvironment env, ILogger<GameStore> logger)
    {
        _bank = bank;
        _opts = opts.Value;
        _logger = logger;
        _statePath = Path.IsPathRooted(_opts.StatePath)
            ? _opts.StatePath
            : Path.Combine(env.ContentRootPath, _opts.StatePath);
        Load();
    }

    // ---------- public API (each returns a fresh snapshot) ----------

    public StateDto AddTeam(string name)
    {
        lock (_lock)
        {
            if (_phase == GamePhase.Finished)
                throw new GameException("Игра завершена — нажмите «Новая игра», чтобы добавлять команды.");

            name = (name ?? "").Trim();
            if (name.Length == 0) throw new GameException("Введите название команды.");
            if (name.Length > 40) throw new GameException("Название команды не должно превышать 40 символов.");
            if (_teams.Any(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase)))
                throw new GameException($"Команда «{name}» уже существует.");

            _teams.Add(new TeamState { Name = name, ColorIndex = _teams.Count % 10 });
            Save();
            return Build();
        }
    }

    public StateDto RemoveTeam(Guid id)
    {
        lock (_lock)
        {
            if (_phase != GamePhase.Setup)
                throw new GameException("Удалять команды можно только до начала игры.");
            var team = _teams.FirstOrDefault(t => t.Id == id) ?? throw new GameException("Команда не найдена.");
            _teams.Remove(team);
            if (_activeTeamId == id) _activeTeamId = null;
            for (var i = 0; i < _teams.Count; i++) _teams[i].ColorIndex = i % 10;
            Save();
            return Build();
        }
    }

    public StateDto Start()
    {
        lock (_lock)
        {
            if (_phase == GamePhase.Playing) throw new GameException("Игра уже идёт.");
            if (_phase == GamePhase.Finished) throw new GameException("Игра завершена — начните новую.");
            if (_teams.Count == 0) throw new GameException("Добавьте хотя бы одну команду.");
            _phase = GamePhase.Playing;
            Save();
            return Build();
        }
    }

    public StateDto SetActiveTeam(Guid id)
    {
        lock (_lock)
        {
            RequirePlaying();
            var team = GetTeam(id);
            _activeTeamId = team.Id;
            Save();
            return Build();
        }
    }

    public SpinResultDto Spin(Guid? teamId, string categoryId)
    {
        lock (_lock)
        {
            RequirePlaying();
            if (_turn != null) throw new GameException("Сначала завершите текущий ход.");
            var team = teamId.HasValue
                ? GetTeam(teamId.Value)
                : _activeTeamId.HasValue
                    ? GetTeam(_activeTeamId.Value)
                    : throw new GameException("Сначала выберите команду — чей сейчас ход.");

            var cat = _bank.Categories.FirstOrDefault(c => c.Id == categoryId)
                      ?? throw new GameException("Категория не найдена.");

            var pool = cat.Questions.Where(q => _used.All(u => u.QuestionId != q.Id)).ToList();
            if (pool.Count == 0) throw new GameException("В этой категории не осталось вопросов.");

            _activeTeamId = team.Id;

            // 80% — вопрос, 20% — модификатор счёта. Матожидание модификаторов ~0,
            // поэтому они не ломают баланс: +1(6%) +2(4%) −1(6%) −2(4%).
            var roll = _rnd.Next(100);
            if (roll < 80)
            {
                var picked = pool[_rnd.Next(pool.Count)];
                _turn = new TurnState { TeamId = team.Id, QuestionId = picked.Id };
                _used.Add(new UsedEntry { QuestionId = picked.Id, TeamId = team.Id, TeamName = team.Name });

                Save();
                return new SpinResultDto(Build(), new SpinOutcomeDto(
                    "question", "", 0, team.Score, team.Id, team.Name,
                    picked.Id, picked.NumberLabel));
            }

            var (kind, delta) = roll switch
            {
                < 86 => ("plus1", 1),
                < 90 => ("plus2", 2),
                < 96 => ("minus1", -1),
                _ => ("minus2", -2)
            };
            team.Score += delta;
            var abs = Math.Abs(delta);
            var label = (delta > 0 ? "+" : "−") + abs + " " + QuizBank.Plural(abs, "балл", "балла", "баллов");

            Save();
            return new SpinResultDto(Build(), new SpinOutcomeDto(
                kind, label, delta, team.Score, team.Id, team.Name, null, null));
        }
    }

    public StateDto Lifeline(string type)
    {
        lock (_lock)
        {
            RequirePlaying();
            var turn = _turn ?? throw new GameException("Сейчас нет открытого вопроса.");
            if (turn.HasAnswered) throw new GameException("Ответ на вопрос уже дан.");

            var team = GetTeam(turn.TeamId);
            var q = GetQuestion(turn.QuestionId);
            type = (type ?? "").Trim().ToLowerInvariant();

            switch (type)
            {
                case "fifty":
                    if (team.FiftyUsed) throw new GameException("Подсказка «50:50» этой командой уже использована.");
                    team.FiftyUsed = true;
                    var wrong = q.Options
                        .Where(o => !o.Correct && !turn.HiddenLetters.Contains(o.Letter))
                        .Select(o => o.Letter)
                        .ToList();
                    Shuffle(wrong);
                    foreach (var letter in wrong.Take(2))
                        if (!turn.HiddenLetters.Contains(letter)) turn.HiddenLetters.Add(letter);
                    turn.HiddenLetters.Sort();
                    break;
                case "phone":
                    if (team.PhoneUsed) throw new GameException("Подсказка «Звонок учителю» этой командой уже использована.");
                    team.PhoneUsed = true;
                    break;
                case "audience":
                    if (team.AudienceUsed) throw new GameException("Подсказка «Помощь зала» этой командой уже использована.");
                    team.AudienceUsed = true;
                    break;
                case "insurance":
                    if (team.InsuranceUsed) throw new GameException("Страховка этой командой уже использована.");
                    if (turn.Doubled) throw new GameException("Страховку нельзя совмещать с удвоением.");
                    if (turn.Insured) throw new GameException("Страховка уже действует на этот вопрос.");
                    team.InsuranceUsed = true;
                    turn.Insured = true;
                    break;
                case "double":
                    if (team.DoubleUsed) throw new GameException("Удвоение этой командой уже использовано.");
                    if (turn.Insured) throw new GameException("Удвоение нельзя совмещать со страховкой.");
                    if (turn.Doubled) throw new GameException("Удвоение уже действует на этот вопрос.");
                    team.DoubleUsed = true;
                    turn.Doubled = true;
                    break;
                default:
                    throw new GameException("Неизвестная подсказка.");
            }

            Save();
            return Build();
        }
    }

    /// <summary>
    /// Передать текущий вопрос другой команде. Разрешено не более одного раза за ход
    /// и не более одного раза за игру для каждой команды.
    /// </summary>
    public StateDto Transfer(Guid targetTeamId)
    {
        lock (_lock)
        {
            RequirePlaying();
            var turn = _turn ?? throw new GameException("Сейчас нет открытого вопроса.");
            if (turn.HasAnswered) throw new GameException("Ответ на вопрос уже дан.");
            if (turn.Transferred) throw new GameException("За этот ход вопрос уже передавали — второй раз нельзя.");

            var team = GetTeam(turn.TeamId);
            var target = GetTeam(targetTeamId);
            if (target.Id == team.Id) throw new GameException("Нельзя передать вопрос той же самой команде.");
            if (team.TransferUsed) throw new GameException("Передача вопроса этой командой уже использована.");

            team.TransferUsed = true;
            turn.Transferred = true;
            turn.TeamId = target.Id;
            _activeTeamId = target.Id;

            var entry = _used.FirstOrDefault(u => u.QuestionId == turn.QuestionId);
            if (entry != null) { entry.TeamId = target.Id; entry.TeamName = target.Name; }

            Save();
            return Build();
        }
    }

    /// <summary>Time is up: reveal the answer but award/deduct nothing.</summary>
    public StateDto Timeout()
    {
        lock (_lock)
        {
            RequirePlaying();
            var turn = _turn ?? throw new GameException("Сейчас нет открытого вопроса.");
            if (turn.HasAnswered) throw new GameException("Ответ на этот вопрос уже дан.");

            turn.TimedOut = true;
            Save();
            return Build();
        }
    }

    public StateDto Answer(string letter)
    {
        lock (_lock)
        {
            RequirePlaying();
            var turn = _turn ?? throw new GameException("Сейчас нет открытого вопроса.");
            if (turn.HasAnswered) throw new GameException("Ответ на этот вопрос уже дан.");

            letter = (letter ?? "").Trim().ToUpperInvariant();
            var q = GetQuestion(turn.QuestionId);
            if (q.Options.All(o => o.Letter != letter)) throw new GameException("Такого варианта ответа нет.");
            if (turn.HiddenLetters.Contains(letter)) throw new GameException("Этот вариант исключён подсказкой «50:50».");

            var team = GetTeam(turn.TeamId);
            var correct = string.Equals(letter, q.CorrectLetter, StringComparison.OrdinalIgnoreCase);

            turn.ChosenLetter = letter;
            turn.WasCorrect = correct;

            var stake = q.Points * (turn.Doubled ? 2 : 1);
            var delta = correct ? stake : (turn.Insured ? 0 : -stake);
            team.Score += delta;
            if (correct) team.CorrectCount++; else team.WrongCount++;

            var entry = _used.FirstOrDefault(u => u.QuestionId == q.Id);
            if (entry != null)
            {
                entry.ChosenLetter = letter;
                entry.WasCorrect = correct;
            }

            Save();
            return Build();
        }
    }

    /// <summary>Team gives up on the current question: no score change, question stays consumed.</summary>
    public StateDto Pass()
    {
        lock (_lock)
        {
            RequirePlaying();
            if (_turn == null) throw new GameException("Сейчас нет открытого хода.");
            if (_turn.HasAnswered) throw new GameException("Ответ уже дан — просто закройте ход.");
            _turn = null;
            Save();
            return Build();
        }
    }

    /// <summary>Close the current turn (after an answer was revealed, or abandon it).</summary>
    public StateDto CloseTurn()
    {
        lock (_lock)
        {
            if (_turn == null) throw new GameException("Сейчас нет открытого хода.");
            _turn = null;
            Save();
            return Build();
        }
    }

    public StateDto Finish()
    {
        lock (_lock)
        {
            if (_phase != GamePhase.Playing) throw new GameException("Игра сейчас не идёт.");
            if (_teams.Count == 0) throw new GameException("В игре нет команд.");
            _turn = null;
            _phase = GamePhase.Finished;
            var max = _teams.Max(t => t.Score);
            _winners = _teams.Where(t => t.Score == max).Select(t => t.Id).ToList();
            Save();
            return Build();
        }
    }

    public StateDto Reset(bool keepTeams)
    {
        lock (_lock)
        {
            _phase = GamePhase.Setup;
            _used.Clear();
            _turn = null;
            _winners = null;
            _activeTeamId = null;
            if (keepTeams)
            {
                foreach (var t in _teams)
                {
                    t.Score = 0;
                    t.FiftyUsed = false;
                    t.PhoneUsed = false;
                    t.AudienceUsed = false;
                    t.TransferUsed = false;
                    t.InsuranceUsed = false;
                    t.DoubleUsed = false;
                    t.CorrectCount = 0;
                    t.WrongCount = 0;
                }
            }
            else
            {
                _teams.Clear();
            }
            Save();
            return Build();
        }
    }

    public StateDto Snapshot()
    {
        lock (_lock) return Build();
    }

    // ---------- internals ----------

    private void RequirePlaying()
    {
        if (_phase != GamePhase.Playing)
            throw new GameException(_phase == GamePhase.Setup ? "Игра ещё не начата." : "Игра завершена.");
    }

    private TeamState GetTeam(Guid id) =>
        _teams.FirstOrDefault(t => t.Id == id) ?? throw new GameException("Команда не найдена.");

    private QuizQuestion GetQuestion(string id) =>
        _bank.QuestionsById.TryGetValue(id, out var q)
            ? q
            : throw new GameException("Вопрос не найден в банке вопросов.");

    private void Shuffle<T>(List<T> list)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = _rnd.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }

    private StateDto Build()
    {
        var board = _bank.Categories.Select(c =>
        {
            var cells = c.Questions.Select(q =>
            {
                var u = _used.FirstOrDefault(x => x.QuestionId == q.Id);
                return new CellDto(
                    q.Id, q.NumberLabel,
                    u != null,
                    _turn != null && _turn.QuestionId == q.Id,
                    u?.ChosenLetter, u?.WasCorrect, u?.TeamName);
            }).ToList();
            var usedCount = cells.Count(x => x.Used);
            return new BoardCategoryDto(
                c.Id, c.Points, c.Label, c.IsBackup,
                c.Questions.Count, usedCount, c.Questions.Count - usedCount, cells);
        }).ToList();

        TurnDto? turnDto = null;
        if (_turn != null && _bank.QuestionsById.TryGetValue(_turn.QuestionId, out var tq))
        {
            var team = _teams.FirstOrDefault(t => t.Id == _turn.TeamId);
            TurnAnsweredDto? answered = null;
            if (_turn.HasAnswered)
            {
                var wasCorrect = _turn.WasCorrect == true;
                var stake = tq.Points * (_turn.Doubled ? 2 : 1);
                var delta = _turn.TimedOut ? 0 : (wasCorrect ? stake : (_turn.Insured ? 0 : -stake));
                answered = new TurnAnsweredDto(
                    _turn.ChosenLetter, wasCorrect, tq.CorrectLetter, tq.Explanation,
                    delta, team?.Score ?? 0, _turn.TimedOut);
            }
            var catLabel = _bank.Categories.FirstOrDefault(c => c.Id == tq.CategoryId)?.Label ?? "";
            turnDto = new TurnDto(
                _turn.TeamId, team?.Name ?? "—",
                new TurnQuestionDto(
                    tq.Id, tq.NumberLabel, tq.Points, tq.CategoryId, catLabel,
                    tq.Text,
                    tq.Options.Select(o => new OptionDto(o.Letter, o.Text)).ToList(),
                    _turn.HiddenLetters.ToList()),
                answered,
                _turn.Transferred, _turn.Insured, _turn.Doubled);
        }

        var left = Math.Max(_bank.TotalQuestions - _used.Count, 0);

        return new StateDto(
            _phase switch
            {
                GamePhase.Setup => "setup",
                GamePhase.Playing => "playing",
                _ => "finished"
            },
            _teams.Select(t => new TeamDto(
                t.Id, t.Name, t.Score, t.FiftyUsed, t.PhoneUsed, t.AudienceUsed,
                t.TransferUsed, t.InsuranceUsed, t.DoubleUsed,
                t.CorrectCount, t.WrongCount, t.ColorIndex)).ToList(),
            _activeTeamId,
            board,
            turnDto,
            _winners?.ToList(),
            left,
            _bank.TotalQuestions);
    }

    private void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(_statePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var persisted = new PersistedState
            {
                Phase = _phase,
                Teams = _teams.Select(t => new TeamState
                {
                    Id = t.Id, Name = t.Name, Score = t.Score,
                    FiftyUsed = t.FiftyUsed, PhoneUsed = t.PhoneUsed, AudienceUsed = t.AudienceUsed,
                    TransferUsed = t.TransferUsed, InsuranceUsed = t.InsuranceUsed, DoubleUsed = t.DoubleUsed,
                    CorrectCount = t.CorrectCount, WrongCount = t.WrongCount, ColorIndex = t.ColorIndex
                }).ToList(),
                ActiveTeamId = _activeTeamId,
                Used = _used.Select(u => new UsedEntry
                {
                    QuestionId = u.QuestionId, TeamId = u.TeamId, TeamName = u.TeamName,
                    ChosenLetter = u.ChosenLetter, WasCorrect = u.WasCorrect
                }).ToList(),
                Turn = _turn == null ? null : new TurnState
                {
                    TeamId = _turn.TeamId, QuestionId = _turn.QuestionId,
                    HiddenLetters = _turn.HiddenLetters.ToList(),
                    ChosenLetter = _turn.ChosenLetter, WasCorrect = _turn.WasCorrect,
                    Transferred = _turn.Transferred, Insured = _turn.Insured,
                    Doubled = _turn.Doubled, TimedOut = _turn.TimedOut
                },
                Winners = _winners?.ToList()
            };

            var tmp = _statePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(persisted, JsonOpts));
            File.Move(tmp, _statePath, overwrite: true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Не удалось сохранить состояние игры в {Path}", _statePath);
        }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_statePath)) return;

            var persisted = JsonSerializer.Deserialize<PersistedState>(File.ReadAllText(_statePath), JsonOpts);
            if (persisted == null) return;

            _phase = persisted.Phase;
            _teams.Clear();
            _teams.AddRange(persisted.Teams);
            _activeTeamId = persisted.ActiveTeamId;

            _used.Clear();
            _used.AddRange(persisted.Used.Where(u => _bank.QuestionsById.ContainsKey(u.QuestionId)));

            if (persisted.Turn != null &&
                _phase == GamePhase.Playing &&
                _bank.QuestionsById.ContainsKey(persisted.Turn.QuestionId) &&
                _teams.Any(t => t.Id == persisted.Turn.TeamId))
            {
                _turn = persisted.Turn;
            }

            _winners = _phase == GamePhase.Finished ? persisted.Winners : null;
            _logger.LogInformation("Восстановлено сохранённое состояние игры из {Path}: фаза {Phase}", _statePath, _phase);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Не удалось прочитать состояние игры из {Path} — начинаем с чистой игры", _statePath);
        }
    }
}
