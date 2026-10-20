namespace MillionaireQuiz.Game;

/// <summary>
/// Settings bound from configuration section "Game" (env vars: Game__Title, Game__PhoneSeconds, ...).
/// </summary>
public sealed class GameOptions
{
    /// <summary>Override for the quiz title (default: meta.title from quiz.json).</summary>
    public string? Title { get; set; }

    /// <summary>Override for the subtitle.</summary>
    public string? Subtitle { get; set; }

    /// <summary>Override for the theme line.</summary>
    public string? Theme { get; set; }

    /// <summary>Path to the questions file (absolute, or relative to the content root).</summary>
    public string QuizPath { get; set; } = "Data/quiz.json";

    /// <summary>Path where the game state is persisted (absolute, or relative to the content root).</summary>
    public string StatePath { get; set; } = "state/gamestate.json";

    /// <summary>Duration of the "phone a friend" (teacher) timer, seconds.</summary>
    public int PhoneSeconds { get; set; } = 60;

    /// <summary>Duration of the "ask the audience" timer, seconds.</summary>
    public int AudienceSeconds { get; set; } = 60;

    /// <summary>Points value assigned to backup ("резервные") questions.</summary>
    public int BackupPoints { get; set; } = 0;
}
