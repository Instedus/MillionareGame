using System.Text.Json;
using Microsoft.Extensions.Options;

namespace MillionaireQuiz.Game;

public sealed record QuizOption(string Letter, string Text, bool Correct);

public sealed class QuizQuestion
{
    public required string Id { get; init; }
    public required string NumberLabel { get; init; }
    public required int Points { get; init; }
    public required string CategoryId { get; init; }
    public required string Text { get; init; }
    public required IReadOnlyList<QuizOption> Options { get; init; }
    public required string CorrectLetter { get; init; }
    public string? Explanation { get; init; }
}

public sealed class QuizCategory
{
    public required string Id { get; init; }
    public required int Points { get; init; }
    public required string Label { get; init; }
    public required bool IsBackup { get; init; }
    public required IReadOnlyList<QuizQuestion> Questions { get; init; }
}

/// <summary>
/// Immutable bank of questions loaded once from quiz.json at startup.
/// </summary>
public sealed class QuizBank
{
    public string Title { get; private set; } = "КТО ХОЧЕТ СТАТЬ МИЛЛИОНЕРОМ?";
    public string Subtitle { get; private set; } = "";
    public string Theme { get; private set; } = "";
    public IReadOnlyList<QuizCategory> Categories { get; private set; } = Array.Empty<QuizCategory>();
    public IReadOnlyDictionary<string, QuizQuestion> QuestionsById { get; private set; } =
        new Dictionary<string, QuizQuestion>();
    public int TotalQuestions { get; private set; }

    private readonly ILogger<QuizBank> _logger;
    private readonly GameOptions _opts;
    private readonly string _contentRoot;

    public QuizBank(IOptions<GameOptions> opts, IHostEnvironment env, ILogger<QuizBank> logger)
    {
        _opts = opts.Value;
        _contentRoot = env.ContentRootPath;
        _logger = logger;
        Load();
    }

    public static string Plural(int n, string one, string few, string many)
    {
        var m10 = n % 10;
        var m100 = n % 100;
        if (m10 == 1 && m100 != 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    public static string PointsLabel(int n) =>
        n == 0 ? "0 баллов" : $"{n} {Plural(n, "балл", "балла", "баллов")}";

    private void Load()
    {
        var path = Path.IsPathRooted(_opts.QuizPath)
            ? _opts.QuizPath
            : Path.Combine(_contentRoot, _opts.QuizPath);

        if (!File.Exists(path))
            throw new InvalidOperationException(
                $"Файл с вопросами не найден: {path}. Проверьте Game__QuizPath / монтирование тома.");

        _logger.LogInformation("Загружаю вопросы из {Path}", path);
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;

        if (root.TryGetProperty("meta", out var meta))
        {
            Title = GetStr(meta, "title") ?? Title;
            Subtitle = GetStr(meta, "subtitle") ?? "";
            Theme = GetStr(meta, "theme") ?? "";
        }
        if (!string.IsNullOrWhiteSpace(_opts.Title)) Title = _opts.Title.Trim();
        if (!string.IsNullOrWhiteSpace(_opts.Subtitle)) Subtitle = _opts.Subtitle.Trim();
        if (!string.IsNullOrWhiteSpace(_opts.Theme)) Theme = _opts.Theme.Trim();

        var main = new List<QuizQuestion>();
        var backup = new List<QuizQuestion>();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);

        if (root.TryGetProperty("questions", out var qs))
            foreach (var q in qs.EnumerateArray())
                main.Add(Parse(q, isBackup: false, seenIds));

        if (root.TryGetProperty("backup_questions", out var bs))
            foreach (var q in bs.EnumerateArray())
                backup.Add(Parse(q, isBackup: true, seenIds));

        if (main.Count == 0)
            throw new InvalidOperationException("В файле вопросов нет ни одного основного вопроса (массив \"questions\").");

        var cats = new List<QuizCategory>();
        foreach (var g in main.GroupBy(q => q.Points).OrderBy(g => g.Key))
        {
            var list = g
                .OrderBy(q => int.TryParse(q.NumberLabel, out var n) ? n : int.MaxValue)
                .ToList();
            cats.Add(new QuizCategory
            {
                Id = "p" + g.Key,
                Points = g.Key,
                Label = PointsLabel(g.Key),
                IsBackup = false,
                Questions = list
            });
        }

        if (backup.Count > 0)
        {
            var label = _opts.BackupPoints > 0
                ? $"Резерв · {PointsLabel(_opts.BackupPoints)}"
                : "Резерв";
            cats.Add(new QuizCategory
            {
                Id = "backup",
                Points = _opts.BackupPoints,
                Label = label,
                IsBackup = true,
                Questions = backup
            });
        }

        Categories = cats;
        QuestionsById = cats.SelectMany(c => c.Questions).ToDictionary(q => q.Id);
        TotalQuestions = QuestionsById.Count;
    }

    private QuizQuestion Parse(JsonElement q, bool isBackup, HashSet<string> seenIds)
    {
        var numberLabel = "?";
        if (q.TryGetProperty("number", out var numEl))
            numberLabel = numEl.ValueKind == JsonValueKind.Number
                ? numEl.GetInt32().ToString()
                : numEl.GetString() ?? "?";

        var points = !isBackup &&
                     q.TryGetProperty("points", out var pEl) &&
                     pEl.ValueKind == JsonValueKind.Number
            ? pEl.GetInt32()
            : _opts.BackupPoints;

        var text = GetStr(q, "question") ?? "";
        var options = new List<QuizOption>();
        var correctLetter = (GetStr(q, "correct_answer") ?? "").Trim().ToUpperInvariant();

        if (q.TryGetProperty("options", out var optsEl) && optsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var o in optsEl.EnumerateArray())
            {
                var letter = (GetStr(o, "letter") ?? "").Trim().ToUpperInvariant();
                var optText = GetStr(o, "text") ?? "";
                var corr = o.TryGetProperty("correct", out var cEl) &&
                           (cEl.ValueKind == JsonValueKind.True ||
                            (cEl.ValueKind == JsonValueKind.String &&
                             string.Equals(cEl.GetString(), "true", StringComparison.OrdinalIgnoreCase)));
                options.Add(new QuizOption(letter, optText, corr));
                if (corr && string.IsNullOrEmpty(correctLetter)) correctLetter = letter;
            }
        }

        if (options.Count < 2)
            throw new InvalidOperationException($"Вопрос «{numberLabel}»: ожидается минимум 2 варианта ответа.");
        if (options.Count(o => o.Correct) != 1 && string.IsNullOrEmpty(correctLetter))
            throw new InvalidOperationException($"Вопрос «{numberLabel}»: не найден правильный ответ.");
        if (options.Count(o => o.Correct) == 1 && string.IsNullOrEmpty(correctLetter))
            correctLetter = options.First(o => o.Correct).Letter;

        // Normalise the "correct" flags against correctLetter (JSON is authoritative by letter).
        var normOptions = options
            .Select(o => o with { Correct = string.Equals(o.Letter, correctLetter, StringComparison.OrdinalIgnoreCase) })
            .ToList();
        if (normOptions.Count(o => o.Correct) != 1)
            throw new InvalidOperationException(
                $"Вопрос «{numberLabel}»: буква правильного ответа «{correctLetter}» не совпадает с вариантами.");

        var baseId = (isBackup ? "b" : "q") + numberLabel;
        var id = baseId;
        var k = 2;
        while (!seenIds.Add(id)) id = $"{baseId}_{k++}";

        return new QuizQuestion
        {
            Id = id,
            NumberLabel = numberLabel,
            Points = points,
            CategoryId = isBackup ? "backup" : "p" + points,
            Text = text,
            Options = normOptions,
            CorrectLetter = correctLetter,
            Explanation = GetStr(q, "explanation")
        };
    }

    private static string? GetStr(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
